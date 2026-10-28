from __future__ import annotations

import contextlib

NODE_LABELS = [
    "Person", "Team", "Service", "Repo", "Document", "Ticket", "Decision", "Message",
    "Session", "Turn", "EpisodicMemory", "SemanticMemory", "ProceduralMemory",
    "Finding", "AgentHandoff",
]

RELATIONSHIPS = [
    "MEMBER_OF", "OWNS", "AUTHORED", "ASSIGNED_TO", "MENTIONS", "DISCUSSED_IN",
    "DECIDED_BY", "RELATES_TO", "DEPENDS_ON", "KNOWS_ABOUT", "IN_REPO", "BLOCKED_BY",
    "CONTAINS", "RECORDED", "REMEMBERS",
]

NODE_COLORS = {
    "Person": "#D8B4FE", "Team": "#9B6FD4", "Service": "#A7F3D0", "Ticket": "#FFD873",
    "Decision": "#FF75B8", "Document": "#A5A5A1", "Message": "#707070", "Repo": "#8FDCC0",
    "Session": "#A3A3A3", "Turn": "#8A8A8A", "EpisodicMemory": "#F3E8FF",
    "SemanticMemory": "#D8B4FE", "ProceduralMemory": "#9B6FD4", "Finding": "#9C6A60",
    "AgentHandoff": "#414140",
}


async def init_schema(client) -> None:
    for label in NODE_LABELS:
        with contextlib.suppress(Exception):
            await client.write(f"CREATE INDEX FOR (n:{label}) ON (n.id)")
    secondary = [
        "CREATE INDEX FOR (p:Person) ON (p.name)",
        "CREATE INDEX FOR (s:Service) ON (s.name)",
        "CREATE INDEX FOR (t:Ticket) ON (t.status)",
        "CREATE INDEX FOR (s:Session) ON (s.user_id)",
        "CREATE INDEX FOR (m:EpisodicMemory) ON (m.user_id)",
        "CREATE INDEX FOR (m:SemanticMemory) ON (m.user_id)",
    ]
    for cypher in secondary:
        with contextlib.suppress(Exception):
            await client.write(cypher)
    for label in NODE_LABELS:
        with contextlib.suppress(Exception):
            await client.write(f"CREATE UNIQUE INDEX FOR (n:{label}) ON (n.id)")
