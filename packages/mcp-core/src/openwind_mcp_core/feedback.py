"""Feedback tool: an end-of-session retrospective channel.

The calling LLM may invoke the ``feedback`` tool at the end of a meaningful
conversation, AT MOST ONCE per session, to do one of two things:

1. ``assistant_reflection`` — share its own honest take on how the
   interaction went: what worked, what was awkward, what it had to
   guess, what felt missing. Honest is more useful than polite.

2. ``user_message`` — relay a message the user explicitly asked to
   pass on (e.g. "dis-leur que le routage du raz de Sein est faux",
   "tell them the complexity rating is too pessimistic"). Verbatim
   when possible.

Cloud-agnostic by construction. The persistence target is injected as a
``FeedbackSink`` callable; ``mcp-core`` never imports ``huggingface_hub``.
The HF Spaces wrapper plugs in a ``CommitScheduler``-backed sink that
appends to a private dataset (see ``packages/hf-space/app.py``).

Local dev with no sink wired falls back to ``stderr_sink`` so the payload
shape can be inspected without setting up a dataset.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

logger = logging.getLogger(__name__)


FeedbackKind = Literal["assistant_reflection", "user_message"]
FeedbackHelpful = Literal[1, 2, 3, 4, 5]

_MAX_MESSAGE_CHARS = 2000
_MAX_TOPICS = 5
_MAX_TOPIC_CHARS = 40


class FeedbackSink(Protocol):
    """Persists a feedback entry. MUST NOT raise — wrap your I/O.

    Implementations are expected to be cheap and non-blocking; the HF
    sink uses a ``CommitScheduler`` background thread so the tool call
    returns immediately even when the dataset push is in flight.
    """

    def __call__(self, entry: dict[str, Any]) -> None: ...


def stderr_sink(entry: dict[str, Any]) -> None:
    """Default sink: log to stderr at INFO level."""
    logger.info("openwind.feedback %s", entry)


def build_feedback_entry(
    *,
    kind: str,
    message: str,
    helpful: int | None = None,
    topics: list[str] | None = None,
) -> dict[str, Any]:
    """Normalize a feedback payload into the JSONL row shape.

    Truncates ``message`` and caps ``topics`` to keep the dataset rows
    bounded against a runaway or pathological caller.
    """
    if len(message) > _MAX_MESSAGE_CHARS:
        message = message[:_MAX_MESSAGE_CHARS] + " ...[truncated]"
    norm_topics: list[str] | None = None
    if topics:
        norm_topics = []
        for t in topics[:_MAX_TOPICS]:
            tag = str(t).strip()
            if not tag:
                continue
            if len(tag) > _MAX_TOPIC_CHARS:
                tag = tag[:_MAX_TOPIC_CHARS]
            norm_topics.append(tag)
        if not norm_topics:
            norm_topics = None
    return {
        "feedback_id": uuid.uuid4().hex,
        "received_at": datetime.now(UTC).isoformat(),
        "kind": kind,
        "message": message,
        "helpful": helpful,
        "topics": norm_topics,
    }
