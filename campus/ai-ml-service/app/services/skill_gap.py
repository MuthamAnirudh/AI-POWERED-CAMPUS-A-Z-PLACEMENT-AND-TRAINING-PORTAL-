"""AI-powered skill-gap analysis used by the Resume/Career Fit flow.

The endpoint is deliberately tolerant: it normalizes user input, asks the configured
LLM for a structured analysis, validates the answer, and falls back to the curated role
catalogue when the provider is unavailable. This keeps the UI from ever receiving a
provider/parser error while still using real AI whenever a provider is configured.
"""
import json
import logging
import re
from typing import Optional

from app.services.llm_providers import call_llm, parse_json_loose
from app.services.ai_reliability import check_reliability

logger = logging.getLogger("ai_ml_service.skill_gap")

ROLE_SKILLS = {
    "full stack developer": ["HTML", "CSS", "JavaScript", "React", "Node.js", "Express", "SQL", "Git", "REST APIs", "MongoDB"],
    "data analyst": ["Excel", "SQL", "Python", "Power BI", "Tableau", "Statistics", "Pandas", "Data Visualization", "A/B Testing"],
    "data scientist": ["Python", "Statistics", "Machine Learning", "Pandas", "NumPy", "scikit-learn", "SQL", "Deep Learning", "Data Visualization"],
    "devops engineer": ["Linux", "Docker", "Kubernetes", "CI/CD", "AWS", "Git", "Terraform", "Bash", "Monitoring"],
    "android developer": ["Java", "Kotlin", "Android Studio", "XML", "REST APIs", "SQLite", "Git", "Material Design", "Firebase"],
    "cybersecurity analyst": ["Networking", "Linux", "SIEM", "Python", "OWASP Top 10", "Risk Assessment", "Penetration Testing", "Firewalls", "Incident Response"],
    "cloud engineer": ["AWS", "Azure", "GCP", "Terraform", "Docker", "Kubernetes", "Linux", "Networking", "CI/CD"],
    "ui/ux designer": ["Figma", "Wireframing", "User Research", "Prototyping", "Design Systems", "Usability Testing", "Accessibility"],
}

ALIASES = {
    "frontend developer": "Full Stack Developer",
    "backend developer": "Full Stack Developer",
    "software engineer": "Full Stack Developer",
    "data analyst": "Data Analyst",
    "data scientist": "Data Scientist",
    "devops": "DevOps Engineer",
    "cloud engineer": "Cloud Engineer",
    "cyber security analyst": "Cybersecurity Analyst",
    "cybersecurity analyst": "Cybersecurity Analyst",
    "ui ux designer": "UI/UX Designer",
}


def _norm(v: str) -> str:
    return re.sub(r"[^a-z0-9+#]+", "", str(v or "").lower())


def _clean_list(value, limit=12):
    if not isinstance(value, list):
        return []
    out = []
    seen = set()
    for item in value:
        text = re.sub(r"\s+", " ", str(item or "")).strip()
        if not text:
            continue
        key = _norm(text)
        if key and key not in seen:
            seen.add(key)
            out.append(text[:100])
        if len(out) >= limit:
            break
    return out


def _fallback(role: str, current: list[str]):
    canonical = ALIASES.get(role.lower(), role)
    expected = ROLE_SKILLS.get(role.lower()) or ROLE_SKILLS.get(canonical.lower())
    if not expected:
        # Unknown roles still get a useful, role-specific baseline rather than a 400/404.
        expected = ["Core domain fundamentals", "Communication", "Problem solving", "Data literacy", "Project delivery", "Version control", "Testing", "Documentation"]
    have = {_norm(s) for s in current if _norm(s)}
    matched = [s for s in expected if _norm(s) in have]
    missing = [s for s in expected if _norm(s) not in have]
    return {
        "target_role": role,
        "need": expected[:12],
        "matched": matched[:12],
        "missing": missing[:12],
        "pct": round(100 * len(matched) / max(1, len(expected))),
        "notes": f"Prioritize {missing[0]} next for {role}." if missing else f"Keep strengthening your existing skills for {role}.",
        "generated_by": "curated-fallback",
        "ai_enriched": False,
    }


async def analyze(target_role: str, current_skills: list[str], resume_text: Optional[str] = None) -> dict:
    role = re.sub(r"\s+", " ", str(target_role or "").strip())[:180]
    current = _clean_list(current_skills, 40)
    fallback = _fallback(role, current)
    if not role:
        return fallback

    system = (
        "You are an expert campus-placement career coach. Analyze a student's skills and resume "
        "against any target role. Credit transferable skills and evidence in the resume. "
        "Return ONLY strict JSON with exactly these keys: need (array of up to 12 concise skills), "
        "matched (subset of need), missing (subset of need), notes (one actionable sentence). "
        "Do not invent qualifications or job requirements that are clearly unrelated to the role."
    )
    user = json.dumps({
        "target_role": role,
        "current_skills": current,
        "resume": (resume_text or "")[:6000],
    }, ensure_ascii=False)
    try:
        res = await call_llm(system, user, {"jsonMode": True, "maxTokens": 650, "temperature": 0.25})
        parsed = parse_json_loose(res.get("text", ""))
        need = _clean_list(parsed.get("need"), 12)
        matched_raw = _clean_list(parsed.get("matched"), 12)
        missing_raw = _clean_list(parsed.get("missing"), 12)
        if not need:
            raise ValueError("LLM returned no skill requirements")
        need_keys = {_norm(x) for x in need}
        matched = [x for x in matched_raw if _norm(x) in need_keys]
        missing = [x for x in missing_raw if _norm(x) in need_keys and _norm(x) not in {_norm(m) for m in matched}]
        if not missing:
            missing = [x for x in need if _norm(x) not in {_norm(m) for m in matched}]
        notes = re.sub(r"\s+", " ", str(parsed.get("notes") or "")).strip()[:500]
        if not notes:
            notes = f"Prioritize {missing[0]} next for {role}." if missing else f"Keep strengthening your existing skills for {role}."
        known = [f"Target role: {role}."] + [f"Student has {s}." for s in current] + [f"Student is missing {s}." for s in missing]
        reliability = check_reliability(notes, known)
        if reliability.get("confidence_label") == "low":
            notes = f"Prioritize {missing[0]} next for {role}." if missing else notes
        return {
            "target_role": role,
            "need": need,
            "matched": matched,
            "missing": missing,
            "pct": round(100 * len(matched) / max(1, len(need))),
            "notes": notes,
            "generated_by": f"llm:{res.get('provider', 'provider')}",
            "ai_enriched": True,
            "reliability": reliability,
        }
    except Exception as exc:
        logger.warning("Skill-gap LLM failed; using grounded fallback: %s: %s", type(exc).__name__, exc)
        fallback["llm_unavailable"] = True
        return fallback
