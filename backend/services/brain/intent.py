from __future__ import annotations

import re

CONVERSATIONAL = "conversational"
CAPABILITY = "capability"
GRAPH = "graph"
UNKNOWN = "unknown"


class Intent:
    def __init__(self, kind: str, reason: str):
        self.kind = kind
        self.reason = reason
        self.is_graph = kind in (GRAPH, UNKNOWN)


GREETING = re.compile(r"^\s*(hi|hey|hello|yo|hiya|good\s+(morning|afternoon|evening)|howdy|greetings|namaste)\b[\s!.?]*$", re.IGNORECASE)
THANKS = re.compile(r"^\s*(thanks?|thank\s+you|ta|cheers|nice|perfect|great|awesome|cool|good\s+(job|work)|appreciate\s+it)\b[\s!.?]*$", re.IGNORECASE)
FAREWELL = re.compile(r"^\s*(bye|goodbye|see\s+(you|ya)|cya|later|gtg|good\s+night)\b[\s!.?]*$", re.IGNORECASE)
POLITE = re.compile(r"^\s*(please|ok|okay|sure|got it|understood|cool)\b[\s!.?]*$", re.IGNORECASE)
CAPABILITY_RE = re.compile(r"\b(what can you do|what can (i|we) (ask|do)|who are you|what are you|how do you work|what do you know|help|how do i use|what is this|introduce yourself|what can this do)\b", re.IGNORECASE)
ID_LOOKUP = re.compile(r"\b(service|person|ticket|decision|document|message|team|repo):", re.IGNORECASE)
TICKET_KEY = re.compile(r"\bMER-\d{3,5}\b", re.IGNORECASE)
EXPLORE = re.compile(r"\b(something|anything|anything interesting|surprise me|show me|give me|tell me about|what do you know|anything notable|what.s going on|what.s happening|summary|overview|highlights?)\b", re.IGNORECASE)


def classify(question: str) -> Intent:
    text = (question or "").strip()
    if not text:
        return Intent(CONVERSATIONAL, "empty message")
    if ID_LOOKUP.search(text) or TICKET_KEY.search(text):
        return Intent(GRAPH, "explicit node id")
    if GREETING.match(text):
        return Intent(CONVERSATIONAL, "greeting")
    if THANKS.match(text):
        return Intent(CONVERSATIONAL, "thanks")
    if FAREWELL.match(text):
        return Intent(CONVERSATIONAL, "farewell")
    words = text.split()
    if POLITE.match(text) and len(words) <= 3:
        return Intent(CONVERSATIONAL, "acknowledgement")
    if CAPABILITY_RE.search(text):
        return Intent(CAPABILITY, "asks what this can do")
    word_tokens = re.findall(r"[A-Za-z][A-Za-z0-9-]*", text)
    if len(word_tokens) == 1 and len(word_tokens[0]) > 2:
        return Intent(GRAPH, "bare entity name")
    if EXPLORE.search(text) and len(word_tokens) <= 6:
        return Intent(GRAPH, "open-ended exploration")
    if text.endswith("?") or re.match(r"^\s*(who|what|when|where|which|how|why|list|show|find|get|tell|file|create|open|assign|update|close|reopen|record|note|remember|page|escalate)", text, re.IGNORECASE):
        return Intent(GRAPH, "question form")
    return Intent(UNKNOWN, "unclassified")
