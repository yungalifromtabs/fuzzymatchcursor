#!/usr/bin/env python3
"""
Python script to process CSV file data with fuzzy matching.
This script receives a CSV file path as an argument and processes it.
"""

from __future__ import annotations

import csv
import io
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any, Set

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from openai import OpenAI


# ----------------------------
# Config
# ----------------------------

@dataclass
class MatchConfig:
    # Cleaning
    trim_whitespace: bool = True
    case_insensitive: bool = True
    collapse_whitespace: bool = True
    remove_punctuation: bool = True
    normalize_unicode: bool = True
    ampersand_to_and: bool = False
    strip_common_suffixes: bool = False

    # Column swap rule (your requirement)
    allow_swap_columns_by_row_count: bool = True

    # AI matching behavior
    embedding_model: str = "text-embedding-3-small"
    chunk_size: int = 100
    allow_many_to_one_ai: bool = False  # if False, AI step won't reuse B values already used (greedy one-to-one)


COMMON_SUFFIXES = {
    "inc", "inc.", "llc", "l.l.c", "ltd", "ltd.", "co", "co.", "corp", "corp.",
    "corporation", "company", "limited", "plc"
}

PUNCT_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)
WS_RE = re.compile(r"\s+")


# ----------------------------
# Cleaning / normalization
# ----------------------------

def normalize_text(s: str, cfg: MatchConfig) -> str:
    if s is None:
        return ""
    out = s

    if cfg.normalize_unicode:
        out = unicodedata.normalize("NFKC", out)

    if cfg.trim_whitespace:
        out = out.strip()

    if cfg.collapse_whitespace:
        out = WS_RE.sub(" ", out)

    if cfg.case_insensitive:
        out = out.lower()

    if cfg.ampersand_to_and:
        out = out.replace("&", " and ")

    if cfg.remove_punctuation:
        out = PUNCT_RE.sub(" ", out)
        if cfg.collapse_whitespace:
            out = WS_RE.sub(" ", out).strip()

    if cfg.strip_common_suffixes:
        tokens = out.split()
        while tokens and tokens[-1] in COMMON_SUFFIXES:
            tokens.pop()
        out = " ".join(tokens)

    return out


def normalize_list(values: List[str], cfg: MatchConfig) -> List[str]:
    return [normalize_text(v or "", cfg) for v in values]


# ----------------------------
# CSV helpers
# ----------------------------

def parse_csv(csv_bytes: bytes) -> Tuple[List[Dict[str, str]], List[str]]:
    text = csv_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []
    rows = [r for r in reader]
    return rows, headers


def count_non_empty(values: List[str], cfg: MatchConfig) -> int:
    """Count non-empty values after normalization."""
    if not values:
        return 0
    count = 0
    for v in values:
        normalized = normalize_text(v or "", cfg)
        if normalized.strip():
            count += 1
    return count


# ----------------------------
# Exact matching
# ----------------------------

def build_norm_to_original_lookup(ref_original: List[str], ref_norm: List[str]) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for orig, norm in zip(ref_original, ref_norm):
        if norm and norm not in lookup:
            lookup[norm] = orig
    return lookup


def exact_match_pass(
    source_original: List[str],
    source_norm: List[str],
    ref_original: List[str],
    ref_norm: List[str],
) -> Tuple[List[Optional[str]], List[str], List[float], Set[int]]:
    """
    Returns aligned lists:
      best_match: original ref string or None
      match_style: "non-ai-exact" for exact matches, "unmatched" for others (will be filled by AI)
      match_quality: 1.0 for exact matches else 0.0
      used_b_indices: indices in ref_original used by exact match (for one-to-one AI behavior)
    """
    lookup_norm_to_orig = build_norm_to_original_lookup(ref_original, ref_norm)

    # To mark used indices, we also want norm->index for first occurrence
    norm_to_index: Dict[str, int] = {}
    for idx, norm in enumerate(ref_norm):
        if norm and norm not in norm_to_index:
            norm_to_index[norm] = idx

    best: List[Optional[str]] = []
    style: List[str] = []
    quality: List[float] = []
    used_b_indices: Set[int] = set()

    for norm in source_norm:
        if norm and norm in lookup_norm_to_orig:
            best.append(lookup_norm_to_orig[norm])
            style.append("non-ai-exact")
            quality.append(1.0)
            used_b_indices.add(norm_to_index[norm])
        else:
            best.append(None)
            style.append("unmatched")  # Will be replaced by AI step
            quality.append(0.0)

    return best, style, quality, used_b_indices


# ----------------------------
# AI embeddings matcher (adapted from your script)
# ----------------------------

def chunk_list(lst: List[str], chunk_size: int):
    for i in range(0, len(lst), chunk_size):
        yield lst[i:i + chunk_size]


def get_embeddings_for_list(client: OpenAI, texts: List[str], model: str, chunk_size: int) -> List[List[float]]:
    """
    Returns embeddings aligned with `texts`.
    Filters out empty strings and None values before sending to API.
    For empty strings, returns a zero vector embedding.
    Raises if API fails (so your route can return a clean error).
    """
    if not texts:
        return []
    
    # Filter out empty strings and None values, but track their positions
    non_empty_texts: List[str] = []
    non_empty_indices: List[int] = []
    empty_indices: List[int] = []
    
    for i, text in enumerate(texts):
        if text and text.strip():
            non_empty_texts.append(text)
            non_empty_indices.append(i)
        else:
            empty_indices.append(i)
    
    # Get embeddings for non-empty texts
    all_embeddings: List[List[float]] = []
    if non_empty_texts:
        for chunk in chunk_list(non_empty_texts, chunk_size):
            # Filter out any empty strings from chunk (safety check)
            filtered_chunk = [t for t in chunk if t and t.strip()]
            if not filtered_chunk:
                continue
            resp = client.embeddings.create(input=filtered_chunk, model=model)
            all_embeddings.extend([d.embedding for d in resp.data])
    
    # Create result list aligned with original texts
    # Get embedding dimension from first embedding (if available)
    embedding_dim = len(all_embeddings[0]) if all_embeddings else 1536  # default for text-embedding-3-small
    result_embeddings: List[List[float]] = []
    
    # Build result list maintaining original order
    non_empty_emb_idx = 0
    for i in range(len(texts)):
        if i in empty_indices:
            # Use zero vector for empty texts
            zero_vector = [0.0] * embedding_dim
            result_embeddings.append(zero_vector)
        else:
            # Use the corresponding embedding
            result_embeddings.append(all_embeddings[non_empty_emb_idx])
            non_empty_emb_idx += 1
    
    return result_embeddings


def ai_match_batch_embeddings(
    client: OpenAI,
    unmatched_sources_original: List[str],
    ref_values_original: List[str],
    *,
    used_b_indices: Set[int],
    cfg: MatchConfig
) -> List[Dict[str, Any]]:
    """
    Greedy one-to-one matching: Always assigns a best match (no threshold).
    One result per unmatched source:
      {"best_match": <original ref str>, "match_quality": <float>, "b_index": <int>}
    """
    if not unmatched_sources_original:
        return []

    # Embed
    emb_a = get_embeddings_for_list(client, unmatched_sources_original, cfg.embedding_model, cfg.chunk_size)
    emb_b = get_embeddings_for_list(client, ref_values_original, cfg.embedding_model, cfg.chunk_size)

    emb_b_np = np.array(emb_b, dtype=np.float32)

    results: List[Dict[str, Any]] = []
    local_used: Set[int] = set(used_b_indices)  # don't reuse B that exact-match already consumed

    for a_text, a_emb in zip(unmatched_sources_original, emb_a):
        scores = cosine_similarity([a_emb], emb_b_np)[0]  # shape: (len(B),)

        if not cfg.allow_many_to_one_ai:
            # Try to find the best unused match first
            unused_scores = scores.copy()
            for j in local_used:
                unused_scores[j] = -1.0
            
            if np.max(unused_scores) > -1.0:
                # Found an unused match
                max_idx = int(np.argmax(unused_scores))
                best_score = float(unused_scores[max_idx])
            else:
                # All B values are used, fallback to best match overall (allow reuse)
                max_idx = int(np.argmax(scores))
                best_score = float(scores[max_idx])
        else:
            # Many-to-one allowed, just use best match
            max_idx = int(np.argmax(scores))
            best_score = float(scores[max_idx])

        # Always assign a match (no threshold check)
        results.append({
            "best_match": ref_values_original[max_idx],
            "match_quality": best_score,
            "b_index": max_idx
        })
        
        if not cfg.allow_many_to_one_ai:
            local_used.add(max_idx)

    return results


# ----------------------------
# Main entrypoint (call on button click)
# ----------------------------

def run_matching_job(
    csv_bytes: bytes,
    col_a: str,
    col_b: str,
    cfg: Optional[MatchConfig] = None,
) -> bytes:
    cfg = cfg or MatchConfig()

    rows, headers = parse_csv(csv_bytes)
    if col_a not in headers or col_b not in headers:
        raise ValueError(f"CSV must contain selected columns: {col_a}, {col_b}")

    # Originals preserved
    a_original = [(r.get(col_a, "") or "") for r in rows]
    b_original = [(r.get(col_b, "") or "") for r in rows]

    # Swap columns based on row count (non-empty values)
    # Ensure Column A is the shorter list by number of non-empty values
    swapped = False
    if cfg.allow_swap_columns_by_row_count:
        count_a = count_non_empty(a_original, cfg)
        count_b = count_non_empty(b_original, cfg)
        if count_a > count_b:
            a_original, b_original = b_original, a_original
            col_a, col_b = col_b, col_a
            swapped = True

    # Normalized keys for matching only
    a_norm = normalize_list(a_original, cfg)
    b_norm = normalize_list(b_original, cfg)

    # Pass 1: exact match
    best_match, match_style, match_quality, used_b_indices = exact_match_pass(
        source_original=a_original,
        source_norm=a_norm,
        ref_original=b_original,
        ref_norm=b_norm,
    )

    # Unmatched A rows - include all rows that don't have a match yet
    # For empty A values, we'll still try to match them
    unmatched_indices = [i for i, bm in enumerate(best_match) if bm is None]
    unmatched_sources_original = [a_original[i] for i in unmatched_indices]

    # Pass 2: AI embeddings - match all unmatched rows
    if unmatched_sources_original:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY environment variable")

        client = OpenAI(api_key=api_key)

        ai_results = ai_match_batch_embeddings(
            client,
            unmatched_sources_original,
            b_original,
            used_b_indices=used_b_indices,
            cfg=cfg
        )

        for j, idx in enumerate(unmatched_indices):
            res = ai_results[j] if j < len(ai_results) else {}
            bm = res.get("best_match")
            q = res.get("match_quality")

            # Always assign a match (greedy matching ensures this)
            # If somehow we don't have a match, use empty string (shouldn't happen)
            best_match[idx] = str(bm) if bm else ""
            match_style[idx] = "ai"
            match_quality[idx] = float(q) if q is not None else 0.0
    
    # Ensure all rows have a best_match (fallback for any remaining None values)
    for i in range(len(best_match)):
        if best_match[i] is None:
            # Fallback: use the first available B value or empty string
            if b_original:
                best_match[i] = b_original[0] if b_original[0] else ""
            else:
                best_match[i] = ""
            match_style[i] = "ai"
            match_quality[i] = 0.0

    # Output CSV with required columns (no match_key)
    out_headers = [
        col_a,
        col_b,
        "best_match",
        "match_style",
        "match_quality",
        "columns_swapped",
    ]

    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=out_headers)
    writer.writeheader()

    for i in range(len(rows)):
        writer.writerow({
            col_a: a_original[i],
            col_b: b_original[i],
            "best_match": best_match[i] or "",
            "match_style": match_style[i],
            "match_quality": match_quality[i],
            "columns_swapped": "true" if swapped else "false",
        })

    return out.getvalue().encode("utf-8")


def process_csv(csv_file_path: str, output_file_path: str):
    """
    Process the CSV file with fuzzy matching.
    
    Args:
        csv_file_path: Path to the input CSV file
        output_file_path: Path to save the output CSV file
    """
    # Read the CSV file
    with open(csv_file_path, 'rb') as f:
        csv_bytes = f.read()
    
    # Parse to get headers
    rows, headers = parse_csv(csv_bytes)
    
    if len(headers) < 2:
        raise ValueError("CSV must have at least 2 columns")
    
    # Use first 2 columns
    col_a = headers[0]
    col_b = headers[1]
    
    print(f"Processing CSV with columns: {col_a} and {col_b}")
    
    # Run matching job
    output_bytes = run_matching_job(csv_bytes, col_a, col_b)
    
    # Write output to file
    with open(output_file_path, 'wb') as f:
        f.write(output_bytes)
    
    print(f"Output saved to: {output_file_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 process_csv.py <input_csv_file_path> <output_csv_file_path>", file=sys.stderr)
        sys.exit(1)
    
    input_csv_path = sys.argv[1]
    output_csv_path = sys.argv[2]
    process_csv(input_csv_path, output_csv_path)
