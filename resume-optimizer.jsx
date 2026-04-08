import { useState, useRef, useEffect, useCallback } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const GOLD = "#c9a850";
const BG   = "#07070d";
const SIDE = "#0c0c18";
const T1   = "#eae6db";
const T2   = "#4f4f72";
const T3   = "#2a2a40";

// ─── Prompts ──────────────────────────────────────────────────────────────────
const RESUME_SYS = (tone) => `You are an elite resume strategist and ATS optimization specialist.
Tone: ${tone === "executive" ? "senior executive — strategic, board-level outcomes language" : tone === "entry" ? "entry-level — potential-focused, enthusiastic, transferable skills" : "professional — achievement-focused, precise, results-driven"}.
Rules:
1. Extract ALL info from the resume. Never fabricate or invent experience.
2. Analyze the JD deeply: required skills, keywords, qualifications, seniority signals.
3. Rewrite every bullet point with strong action verbs and measurable impact.
4. Inject JD keywords naturally — do NOT keyword-stuff.
5. Optimize the professional headline and summary for the target role.
Return ONLY valid JSON — no markdown, no backticks, no extra text:
{"name":"","title":"","email":"","phone":"","location":"","linkedin":"","website":"","summary":"3-4 sentence ATS-optimized summary","experience":[{"id":"e0","company":"","role":"","duration":"Mon YYYY – Mon YYYY","location":"City, ST","bullets":[""]}],"education":[{"id":"d0","institution":"","degree":"","year":"","gpa":"","honors":""}],"skills":[""],"certifications":[""],"atsScore":85,"matchedKeywords":["keyword already in resume that matches JD"],"addedKeywords":["new keyword injected"],"gaps":["Real gap: something in JD not covered by resume"],"improvements":["Specific thing changed and why"]}`;

const SCORE_SYS = `You are an ATS scoring expert. Score the resume against the JD WITHOUT rewriting anything.
Return ONLY valid JSON:
{"atsScore":72,"matchedKeywords":[""],"missingKeywords":[""],"gaps":[""],"recommendations":["Actionable improvement suggestion"]}`;

const COVER_SYS = `You are a world-class cover letter writer. Given a resume and job description, craft a compelling, specific, non-generic cover letter. Reference the company, role, and specific JD requirements. Keep it to 3 focused paragraphs.
Return ONLY valid JSON:
{"greeting":"Dear [Name or Hiring Manager],","opening":"First paragraph — hook + why this role","body":"Second paragraph — key match between candidate and role requirements","closing":"Final paragraph — call to action + enthusiasm","signOff":"Best regards,"}`;

const JD_SYS = `Parse this job description into structured data.
Return ONLY valid JSON:
{"role":"","company":"","required":["Must-have requirement"],"preferred":["Nice-to-have"],"experience":"X+ years","education":"e.g. Bachelor's in CS","salary":"if mentioned or empty string","remote":"Remote / Hybrid / On-site","keywords":["top ATS keyword"]}`;

const JOB_SYS = `Generate 6 realistic, varied job listings for this search query. Include different companies, locations, salary ranges. Make descriptions detailed and realistic (200+ words each).
Return ONLY a valid JSON array — no wrapping object:
[{"id":"j1","title":"","company":"","location":"","type":"Full-time","salary":"$X,000–$Y,000/yr","posted":"X days ago","summary":"2-3 sentence teaser.","description":"Full detailed job description with About Us, Responsibilities, Requirements, Nice to Haves, Benefits sections."}]`;

// ─── API helper ───────────────────────────────────────────────────────────────
async function claude(system, content, maxTokens = 2000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(clean);
}

// ─── Storage ──────────────────────────────────────────────────────────────────
const db = {
  async get(k) { try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } },
  async set(k, v) { try { await window.storage.set(k, JSON.stringify(v)); } catch {} },
  async del(k) { try { await window.storage.delete(k); } catch {} },
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const f2b  = f  => new Promise((rs, rj) => { const r = new FileReader(); r.onload = () => rs(r.result.split(",")[1]); r.onerror = rj; r.readAsDataURL(f); });
const f2t  = f  => new Promise((rs, rj) => { const r = new FileReader(); r.onload = e => rs(e.target.result); r.onerror = rj; r.readAsText(f); });

// ─── Inline editable field ────────────────────────────────────────────────────
function Field({ value, onChange, multiline = false, style = {}, placeholder = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { setEditing(false); if (draft !== value) onChange(draft); };
  const base = { fontFamily: "inherit", fontSize: "inherit", color: "inherit", lineHeight: "inherit",
    letterSpacing: "inherit", textTransform: "inherit", fontWeight: "inherit", fontStyle: "inherit",
    textAlign: "inherit", outline: "none", width: "100%", display: "block", ...style };
  if (editing) {
    const es = { ...base, background: "rgba(201,168,80,0.07)", border: "1px dashed rgba(201,168,80,0.5)",
      borderRadius: 3, padding: "2px 6px", resize: "none", boxSizing: "border-box" };
    return multiline
      ? <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          rows={Math.max(2, (draft || "").split("\n").length + 1)} style={es} placeholder={placeholder} />
      : <input autoFocus type="text" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          style={es} placeholder={placeholder} />;
  }
  return (
    <span onClick={() => setEditing(true)} title="Click to edit"
      style={{ ...base, cursor: "text", padding: "2px 0", borderBottom: "1px dashed transparent",
        transition: "border-color .15s", whiteSpace: multiline ? "pre-wrap" : "normal", wordBreak: "break-word" }}
      onMouseEnter={e => e.currentTarget.style.borderBottomColor = "rgba(201,168,80,.4)"}
      onMouseLeave={e => e.currentTarget.style.borderBottomColor = "transparent"}>
      {value || <em style={{ opacity: .3, fontStyle: "normal" }}>{placeholder}</em>}
    </span>
  );
}

// ─── ATS Arc gauge ────────────────────────────────────────────────────────────
function ArcGauge({ score }) {
  const r = 52, len = Math.PI * r;
  const dash  = (Math.min(Math.max(score || 0, 0), 100) / 100) * len;
  const color = score >= 80 ? "#4ade80" : score >= 60 ? GOLD : "#f87171";
  const label = score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Needs Work";
  return (
    <div style={{ textAlign: "center" }}>
      <svg width="130" height="80" viewBox="0 0 130 80">
        <path d="M13,74 A52,52 0 0 1 117,74" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="10" strokeLinecap="round"/>
        <path d="M13,74 A52,52 0 0 1 117,74" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${dash} ${len}`} style={{ transition: "stroke-dasharray 1.4s cubic-bezier(.4,0,.2,1)" }}/>
        <text x="65" y="70" textAnchor="middle" fill={color} fontSize="29" fontWeight="700" fontFamily="Outfit,sans-serif">{score || 0}</text>
      </svg>
      <div style={{ fontSize: 9, letterSpacing: 2.5, color: T2, textTransform: "uppercase", fontFamily: "Outfit,sans-serif", marginTop: -6 }}>ATS Score · {label}</div>
    </div>
  );
}

// ─── Keyword pill ─────────────────────────────────────────────────────────────
function Pill({ text, color = GOLD, bg = "rgba(201,168,80,.08)", border = "rgba(201,168,80,.2)" }) {
  return (
    <span style={{ fontSize: 9.5, background: bg, border: `1px solid ${border}`, borderRadius: 3,
      padding: "2px 8px", color, letterSpacing: .3, whiteSpace: "nowrap" }}>{text}</span>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ title, onUp, onDown, canUp, canDown }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 2.5, textTransform: "uppercase", color: "#666",
        borderBottom: "1.5px solid #e0e0e0", paddingBottom: 5, marginBottom: 12,
        fontFamily: "Outfit,sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>{title}</span>
      <span style={{ opacity: hov ? 1 : 0, transition: "opacity .15s", display: "flex", gap: 3 }}>
        {canUp  && <button onClick={onUp}   style={arrowBtn}>↑</button>}
        {canDown && <button onClick={onDown} style={arrowBtn}>↓</button>}
      </span>
    </div>
  );
}
const arrowBtn = { fontSize: 9, color: GOLD, background: "none", border: "1px solid rgba(201,168,80,.25)",
  borderRadius: 2, padding: "0 5px", cursor: "pointer", lineHeight: "15px" };

// ─── Resume sections ──────────────────────────────────────────────────────────
function ResumeSections({ resume, upd, order, move }) {
  return order.map((sec, idx) => {
    const props = { resume, upd, canUp: idx > 0, canDown: idx < order.length - 1,
      onUp: () => move(idx, -1), onDown: () => move(idx, 1) };
    if (sec === "summary" && resume.summary)
      return (
        <div key="summary" style={{ marginBottom: 22 }}>
          <SectionLabel title="Professional Summary" {...props} />
          <Field value={resume.summary} onChange={v => upd(c => c.summary = v)} multiline
            style={{ fontSize: 13.5, color: "#2a2a2a", lineHeight: 1.8 }} />
        </div>
      );
    if (sec === "experience" && resume.experience?.length)
      return (
        <div key="experience" style={{ marginBottom: 22 }}>
          <SectionLabel title="Experience" {...props} />
          {resume.experience.map((exp, ei) => (
            <div key={exp.id || ei} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field value={exp.role}    onChange={v => upd(c => c.experience[ei].role    = v)} style={{ fontSize: 14.5, fontWeight: 600, color: "#0a0a0a" }} />
                  <Field value={exp.company} onChange={v => upd(c => c.experience[ei].company = v)} style={{ fontSize: 12, color: "#555", fontStyle: "italic", marginTop: 2 }} />
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <Field value={exp.duration} onChange={v => upd(c => c.experience[ei].duration = v)} style={{ fontSize: 10, color: "#777", fontFamily: "Outfit,sans-serif", textAlign: "right" }} />
                  {exp.location && <Field value={exp.location} onChange={v => upd(c => c.experience[ei].location = v)} style={{ fontSize: 9.5, color: "#999", fontFamily: "Outfit,sans-serif", textAlign: "right", marginTop: 2 }} />}
                </div>
              </div>
              <ul style={{ margin: "8px 0 4px", paddingLeft: 18 }}>
                {exp.bullets.map((b, bi) => (
                  <li key={bi} style={{ marginBottom: 5 }}>
                    <Field value={b} onChange={v => upd(c => c.experience[ei].bullets[bi] = v)} multiline style={{ fontSize: 12.5, color: "#2a2a2a", lineHeight: 1.68 }} />
                  </li>
                ))}
              </ul>
              <div style={{ paddingLeft: 18, display: "flex", gap: 14 }}>
                <button onClick={() => upd(c => c.experience[ei].bullets.push("New achievement with measurable impact"))} style={smallBtn(GOLD)}>+ bullet</button>
                {exp.bullets.length > 1 && <button onClick={() => upd(c => c.experience[ei].bullets.pop())} style={smallBtn("#e57373")}>− last</button>}
                {resume.experience.length > 1 && <button onClick={() => upd(c => c.experience.splice(ei, 1))} style={smallBtn("#888")}>× remove role</button>}
              </div>
            </div>
          ))}
          <button onClick={() => upd(c => c.experience.push({ id: uid(), company: "Company Name", role: "Job Title", duration: "YYYY – Present", location: "", bullets: ["Key achievement..."] }))}
            style={{ fontSize: 10, color: GOLD, background: "none", border: "1px dashed rgba(201,168,80,.3)", borderRadius: 3, cursor: "pointer", fontFamily: "Outfit,sans-serif", padding: "3px 12px" }}>
            + Add Experience
          </button>
        </div>
      );
    if (sec === "education" && resume.education?.length)
      return (
        <div key="education" style={{ marginBottom: 22 }}>
          <SectionLabel title="Education" {...props} />
          {resume.education.map((edu, ei) => (
            <div key={edu.id || ei} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <Field value={edu.institution} onChange={v => upd(c => c.education[ei].institution = v)} style={{ fontSize: 14, fontWeight: 600, color: "#0a0a0a" }} />
                <Field value={edu.degree}      onChange={v => upd(c => c.education[ei].degree      = v)} style={{ fontSize: 12, color: "#555", fontStyle: "italic" }} />
                {edu.honors && <Field value={edu.honors} onChange={v => upd(c => c.education[ei].honors = v)} style={{ fontSize: 11, color: "#777" }} />}
              </div>
              <div style={{ textAlign: "right" }}>
                <Field value={edu.year} onChange={v => upd(c => c.education[ei].year = v)} style={{ fontSize: 11, color: "#777", fontFamily: "Outfit,sans-serif", textAlign: "right" }} />
                {edu.gpa && <Field value={edu.gpa} onChange={v => upd(c => c.education[ei].gpa = v)} style={{ fontSize: 10, color: "#888", fontFamily: "Outfit,sans-serif", textAlign: "right", marginTop: 2 }} />}
              </div>
            </div>
          ))}
        </div>
      );
    if (sec === "skills" && resume.skills?.length)
      return (
        <div key="skills" style={{ marginBottom: 22 }}>
          <SectionLabel title="Skills" {...props} />
          <Field value={resume.skills.join(", ")} onChange={v => upd(c => c.skills = v.split(",").map(s => s.trim()).filter(Boolean))}
            multiline style={{ fontSize: 12.5, color: "#2a2a2a", lineHeight: 1.8 }} placeholder="Skills separated by commas" />
        </div>
      );
    if (sec === "certifications" && resume.certifications?.filter(Boolean).length)
      return (
        <div key="certifications" style={{ marginBottom: 8 }}>
          <SectionLabel title="Certifications" {...props} />
          {resume.certifications.filter(Boolean).map((cert, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <span style={{ color: "#ccc", fontSize: 9, flexShrink: 0, paddingTop: 4 }}>◆</span>
              <Field value={cert} onChange={v => upd(c => c.certifications[i] = v)} style={{ fontSize: 12.5, color: "#2a2a2a" }} />
            </div>
          ))}
        </div>
      );
    return null;
  });
}
const smallBtn = (color) => ({ fontSize: 9.5, color, background: "none", border: "none", cursor: "pointer", fontFamily: "Outfit,sans-serif", padding: 0 });

// ─── Resume header (contact row) ──────────────────────────────────────────────
function ContactRow({ resume, upd }) {
  const fields = [["email","✉"],["phone","☏"],["location","◎"],["linkedin","in"],["website","⌘"]].filter(([k]) => resume[k]);
  if (!fields.length) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "5px 16px", marginTop: 12 }}>
      {fields.map(([k, icon]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 9, color: "#bbb", fontFamily: "Outfit,sans-serif" }}>{icon}</span>
          <Field value={resume[k]} onChange={v => upd(c => c[k] = v)} style={{ fontSize: 10.5, color: "#666", fontFamily: "Outfit,sans-serif" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Template: Classic ────────────────────────────────────────────────────────
function ClassicTemplate({ resume, upd, order, move }) {
  return (
    <div id="resume-paper" style={{ padding: "52px 56px 50px", fontFamily: "Cormorant Garamond,Georgia,serif", color: "#1a1a1a" }}>
      <div style={{ textAlign: "center", borderBottom: "2px solid #1a1a1a", paddingBottom: 18, marginBottom: 22 }}>
        <Field value={resume.name}  onChange={v => upd(c => c.name  = v)} style={{ fontSize: 30, fontWeight: 600, letterSpacing: 5, textTransform: "uppercase", color: "#0a0a0a", textAlign: "center", lineHeight: 1.1 }} placeholder="Your Name" />
        <Field value={resume.title} onChange={v => upd(c => c.title = v)} style={{ fontSize: 11, color: "#666", letterSpacing: 3, textTransform: "uppercase", textAlign: "center", fontWeight: 300, marginTop: 6, fontFamily: "Outfit,sans-serif" }} placeholder="Professional Title" />
        <ContactRow resume={resume} upd={upd} />
      </div>
      <ResumeSections resume={resume} upd={upd} order={order} move={move} />
    </div>
  );
}

// ─── Template: Modern (two-column) ───────────────────────────────────────────
function ModernTemplate({ resume, upd, order, move }) {
  const sl = { fontSize: 9, fontWeight: 600, letterSpacing: 2.5, textTransform: "uppercase", color: "#333",
    borderBottom: `2px solid ${GOLD}`, paddingBottom: 4, marginBottom: 12, fontFamily: "Outfit,sans-serif",
    display: "flex", justifyContent: "space-between", alignItems: "center" };
  return (
    <div id="resume-paper" style={{ display: "flex", fontFamily: "Outfit,sans-serif", color: "#1a1a1a", minHeight: 800 }}>
      <div style={{ width: 195, minWidth: 195, background: "#12122a", padding: "40px 18px", color: "#fff", display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <Field value={resume.name}  onChange={v => upd(c => c.name  = v)} style={{ fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "Cormorant Garamond,serif", lineHeight: 1.2 }} />
          <Field value={resume.title} onChange={v => upd(c => c.title = v)} style={{ fontSize: 9.5, color: GOLD, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 6 }} />
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: GOLD, textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Contact</div>
          {[["email","✉"],["phone","☏"],["location","◎"],["linkedin","in"],["website","⌘"]].filter(([k]) => resume[k]).map(([k, icon]) => (
            <div key={k} style={{ display: "flex", gap: 6, marginBottom: 7, alignItems: "flex-start" }}>
              <span style={{ fontSize: 8, color: GOLD, marginTop: 3, flexShrink: 0 }}>{icon}</span>
              <Field value={resume[k]} onChange={v => upd(c => c[k] = v)} style={{ fontSize: 9.5, color: "#ccc", lineHeight: 1.45 }} />
            </div>
          ))}
        </div>
        {resume.skills?.length > 0 && (
          <div>
            <div style={{ fontSize: 8, letterSpacing: 2, color: GOLD, textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Skills</div>
            {resume.skills.map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: "#ddd", marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid rgba(201,168,80,.3)` }}>{s}</div>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, padding: "40px 32px" }}>
        <ResumeSections resume={resume} upd={upd} order={order.filter(s => s !== "skills")} move={move} />
      </div>
    </div>
  );
}

// ─── Template: Minimal ────────────────────────────────────────────────────────
function MinimalTemplate({ resume, upd, order, move }) {
  const sl = { fontSize: 8.5, fontWeight: 600, letterSpacing: 2.5, textTransform: "uppercase", color: "#aaa",
    borderTop: "1px solid #eee", paddingTop: 5, paddingBottom: 0, marginBottom: 13,
    fontFamily: "Outfit,sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center" };
  return (
    <div id="resume-paper" style={{ padding: "60px 68px 56px", fontFamily: "Outfit,sans-serif", color: "#1a1a1a" }}>
      <div style={{ marginBottom: 38 }}>
        <Field value={resume.name}  onChange={v => upd(c => c.name  = v)} style={{ fontSize: 28, fontWeight: 700, color: "#0a0a0a", letterSpacing: -0.5, fontFamily: "Cormorant Garamond,serif" }} />
        <Field value={resume.title} onChange={v => upd(c => c.title = v)} style={{ fontSize: 13, color: "#888", marginTop: 5 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginTop: 11 }}>
          {[["email"],["phone"],["location"],["linkedin"],["website"]].filter(([k]) => resume[k]).map(([k]) => (
            <Field key={k} value={resume[k]} onChange={v => upd(c => c[k] = v)} style={{ fontSize: 11, color: "#888" }} />
          ))}
        </div>
      </div>
      <ResumeSections resume={resume} upd={upd} order={order} move={move} />
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Input state
  const [file,      setFile]      = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [jd,        setJd]        = useState("");
  const [inputMode, setInputMode] = useState("file"); // file | paste
  const [tone,      setTone]      = useState("balanced");
  const [drag,      setDrag]      = useState(false);

  // ── Output state
  const [resume,        setResume]        = useState(null);
  const [originalText,  setOriginalText]  = useState("");
  const [scoreOnly,     setScoreOnly]     = useState(null);
  const [coverLetter,   setCoverLetter]   = useState(null);
  const [parsedJD,      setParsedJD]      = useState(null);
  const [showJDPanel,   setShowJDPanel]   = useState(false);

  // ── Layout
  const [template,     setTemplate]     = useState("classic");
  const [sectionOrder, setSectionOrder] = useState(["summary","experience","education","skills","certifications"]);

  // ── Jobs
  const [jobQuery,    setJobQuery]    = useState("");
  const [jobResults,  setJobResults]  = useState([]);
  const [bookmarks,   setBookmarks]   = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);

  // ── Versions
  const [versions, setVersions] = useState([]);

  // ── UI
  const [activeTab,      setActiveTab]      = useState("resume");
  const [loading,        setLoading]        = useState(false);
  const [loadingType,    setLoadingType]    = useState("");
  const [loadingMsgIdx,  setLoadingMsgIdx]  = useState(0);
  const [err,            setErr]            = useState("");

  const fileRef = useRef(null);
  const LOADING_MSGS = [
    "Analyzing job requirements…",
    "Matching ATS keywords…",
    "Rewriting bullet points…",
    "Crafting your summary…",
    "Calculating match score…",
  ];

  // ── Boot
  useEffect(() => {
    // Load fonts
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Outfit:wght@300;400;500;600;700&display=swap";
    document.head.appendChild(link);
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    loadVersions();
    loadBookmarks();
  }, []);

  // Loading message cycling
  useEffect(() => {
    if (!loading) return;
    const iv = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MSGS.length), 2400);
    return () => clearInterval(iv);
  }, [loading]);

  // ── Storage helpers
  const loadVersions = async () => {
    const ids = await db.get("v-ids") || [];
    const vers = (await Promise.all(ids.map(id => db.get(`v:${id}`)))).filter(Boolean);
    setVersions(vers);
  };
  const saveVersion = async r => {
    const id = uid();
    const label = `${r.title || "Resume"} · ${new Date().toLocaleDateString()}`;
    await db.set(`v:${id}`, { id, label, resume: r, jd, atsScore: r.atsScore, saved: Date.now() });
    const ids = await db.get("v-ids") || [];
    await db.set("v-ids", [...ids.slice(-9), id]);
    loadVersions();
  };
  const deleteVersion = async id => {
    await db.del(`v:${id}`);
    const ids = await db.get("v-ids") || [];
    await db.set("v-ids", ids.filter(i => i !== id));
    loadVersions();
  };
  const loadBookmarks = async () => setBookmarks(await db.get("bookmarks") || []);
  const toggleBookmark = async job => {
    const bms = await db.get("bookmarks") || [];
    const next = bms.find(b => b.id === job.id) ? bms.filter(b => b.id !== job.id) : [...bms, job];
    await db.set("bookmarks", next);
    setBookmarks(next);
  };

  // ── Resume immutable update
  const upd = fn => setResume(prev => { const c = JSON.parse(JSON.stringify(prev)); fn(c); return c; });
  const moveSection = (idx, dir) =>
    setSectionOrder(prev => {
      const next = [...prev], ni = idx + dir;
      if (ni < 0 || ni >= next.length) return prev;
      [next[idx], next[ni]] = [next[ni], next[idx]];
      return next;
    });

  // ── Build message content for Claude
  const buildContent = async (suffix = "") => {
    if (inputMode === "file" && file?.type === "application/pdf") {
      const b64 = await f2b(file);
      return [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        { type: "text", text: `Job Description:\n\n${jd}\n\n${suffix}Return only the JSON.` },
      ];
    }
    const text = inputMode === "paste" ? pasteText : file ? await f2t(file) : pasteText;
    setOriginalText(text);
    return `Resume:\n\n${text}\n\n---\n\nJob Description:\n\n${jd}\n\n${suffix}Return only the JSON.`;
  };

  const hasResume = inputMode === "file" ? !!file : pasteText.trim().length > 0;

  // ── Action handlers
  const handleOptimize = async () => {
    if (!hasResume) { setErr("Please provide your resume."); return; }
    if (!jd.trim())  { setErr("Please paste the job description."); return; }
    setErr(""); setLoading(true); setLoadingType("optimize"); setLoadingMsgIdx(0);
    try {
      const content = await buildContent();
      const r = await claude(RESUME_SYS(tone), content, 4500);
      setResume(r); setScoreOnly(null); setActiveTab("resume");
      silentParseJD();
      await saveVersion(r);
    } catch(e) { console.error(e); setErr("Optimization failed — check inputs and try again."); }
    finally { setLoading(false); }
  };

  const handleScoreOnly = async () => {
    if (!hasResume) { setErr("Please provide your resume."); return; }
    if (!jd.trim())  { setErr("Please paste the job description."); return; }
    setErr(""); setLoading(true); setLoadingType("score"); setLoadingMsgIdx(0);
    try {
      const content = await buildContent();
      const sd = await claude(SCORE_SYS, content, 1000);
      setScoreOnly(sd); setResume(null);
    } catch(e) { console.error(e); setErr("Scoring failed — try again."); }
    finally { setLoading(false); }
  };

  const handleCoverLetter = async () => {
    if (!resume) { setErr("Optimize your resume first."); return; }
    if (!jd.trim()) { setErr("Paste a job description first."); return; }
    setErr(""); setLoading(true); setLoadingType("cover");
    try {
      const cl = await claude(COVER_SYS, `Resume JSON:\n${JSON.stringify(resume)}\n\nJob Description:\n${jd}`, 2000);
      setCoverLetter(cl); setActiveTab("cover");
    } catch(e) { console.error(e); setErr("Cover letter generation failed."); }
    finally { setLoading(false); }
  };

  const handleParseJD = async () => {
    if (!jd.trim()) { setErr("Paste a job description first."); return; }
    setLoading(true); setLoadingType("jd");
    try {
      const p = await claude(JD_SYS, jd, 900);
      setParsedJD(p); setShowJDPanel(true);
    } catch(e) { console.error(e); setErr("JD analysis failed."); }
    finally { setLoading(false); }
  };

  const silentParseJD = async () => {
    if (!jd.trim()) return;
    try { const p = await claude(JD_SYS, jd, 900); setParsedJD(p); } catch {}
  };

  const handleJobSearch = async () => {
    if (!jobQuery.trim()) return;
    setLoading(true); setLoadingType("jobs");
    try {
      const ctx = resume ? `Candidate profile: ${resume.title}, Skills: ${resume.skills?.slice(0,6).join(", ")}.` : "";
      const results = await claude(JOB_SYS, `Search query: "${jobQuery}". ${ctx}`, 3200);
      setJobResults(Array.isArray(results) ? results : []);
    } catch(e) { console.error(e); setErr("Job search failed — try again."); }
    finally { setLoading(false); }
  };

  const handleReOptimizeWithNewJD = async (newJD) => {
    if (!resume) return;
    setJd(newJD); setActiveTab("resume"); setErr("");
    setLoading(true); setLoadingType("optimize"); setLoadingMsgIdx(0);
    try {
      const content = `Resume JSON (already extracted):\n${JSON.stringify(resume)}\n\n---\n\nNew Job Description:\n${newJD}\n\nRe-optimize for this new role. Return only the JSON.`;
      const r = await claude(RESUME_SYS(tone), content, 4500);
      setResume(r); setScoreOnly(null);
      await saveVersion(r);
    } catch(e) { console.error(e); setErr("Re-optimization failed."); }
    finally { setLoading(false); }
  };

  const handlePrint = () => {
    const st = document.createElement("style");
    st.id = "_rp";
    st.textContent = `@media print{body>*{display:none!important}#_rpw{display:block!important;position:fixed;inset:0;background:#fff;z-index:9999}}`;
    document.head.appendChild(st);
    const wrap = document.createElement("div");
    wrap.id = "_rpw"; wrap.style.display = "none";
    const paper = document.getElementById("resume-paper");
    if (paper) wrap.innerHTML = paper.outerHTML;
    document.body.appendChild(wrap);
    window.print();
    setTimeout(() => { document.getElementById("_rp")?.remove(); document.getElementById("_rpw")?.remove(); }, 1500);
  };

  // ── Shared styles
  const sideLabel = { fontSize: 8.5, fontWeight: 600, letterSpacing: 2, color: T2, textTransform: "uppercase", marginBottom: 8, fontFamily: "Outfit,sans-serif" };
  const isL = type => loading && loadingType === type;
  const ResComp = template === "modern" ? ModernTemplate : template === "minimal" ? MinimalTemplate : ClassicTemplate;

  return (
    <div style={{ height: "100vh", background: BG, display: "flex", flexDirection: "column", fontFamily: "Outfit,sans-serif", color: T1, overflow: "hidden" }}>

      {/* ── Top bar ── */}
      <div style={{ height: 50, borderBottom: `1px solid rgba(201,168,80,.1)`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0, background: "rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, background: "linear-gradient(140deg,#d4af50,#7a5e1a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontFamily: "Cormorant Garamond,serif", fontWeight: 600, color: "#000" }}>R</div>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 1.5 }}>ResumeAI</span>
          <span style={{ fontSize: 8.5, color: T2, letterSpacing: 2, textTransform: "uppercase" }}>by Claude</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {resume && <span style={{ fontSize: 8.5, color: T2, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 4, padding: "4px 10px" }}>✎ click any field to edit inline</span>}
          {resume && (
            <button onClick={handlePrint} style={{ fontSize: 9.5, color: GOLD, background: "none", border: `1px solid rgba(201,168,80,.25)`, borderRadius: 4, padding: "5px 12px", cursor: "pointer", fontFamily: "Outfit,sans-serif" }}>
              ↓ Export PDF
            </button>
          )}
          {(resume || scoreOnly || coverLetter) && (
            <button onClick={() => { setResume(null); setScoreOnly(null); setCoverLetter(null); setFile(null); setPasteText(""); setJd(""); setParsedJD(null); setShowJDPanel(false); setOriginalText(""); setActiveTab("resume"); }}
              style={{ fontSize: 9.5, color: T2, background: "none", border: "1px solid rgba(255,255,255,.07)", borderRadius: 4, padding: "5px 12px", cursor: "pointer", fontFamily: "Outfit,sans-serif" }}>
              ↩ Start Over
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 345, minWidth: 345, background: SIDE, overflowY: "auto", borderRight: `1px solid ${T3}`, padding: "20px 17px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Resume input */}
          <div>
            <div style={sideLabel}>Your Resume</div>
            <div style={{ display: "flex", border: `1px solid ${T3}`, borderRadius: 5, overflow: "hidden", marginBottom: 10 }}>
              {[["file","Upload File"],["paste","Paste Text"]].map(([m, lbl]) => (
                <button key={m} onClick={() => setInputMode(m)} style={{ flex: 1, padding: "7px 0", fontSize: 9.5, fontWeight: 500, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "Outfit,sans-serif", cursor: "pointer", border: "none", background: inputMode === m ? "rgba(201,168,80,.1)" : "transparent", color: inputMode === m ? GOLD : T2, borderBottom: inputMode === m ? `2px solid ${GOLD}` : "2px solid transparent", transition: "all .15s" }}>{lbl}</button>
              ))}
            </div>

            {inputMode === "file" ? (
              <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                onClick={() => fileRef.current?.click()}
                style={{ border: `2px dashed ${drag ? GOLD : "rgba(255,255,255,.07)"}`, borderRadius: 8, padding: "24px 14px", textAlign: "center", cursor: "pointer", background: drag ? "rgba(201,168,80,.04)" : "rgba(255,255,255,.01)", transition: "all .18s" }}>
                <input ref={fileRef} type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) setFile(e.target.files[0]); }} />
                {file ? (
                  <>
                    <div style={{ fontSize: 24, marginBottom: 5 }}>📄</div>
                    <div style={{ fontSize: 11.5, color: GOLD, fontWeight: 500, wordBreak: "break-all" }}>{file.name}</div>
                    <div style={{ fontSize: 9, color: T2, marginTop: 3 }}>{(file.size / 1024).toFixed(0)} KB · click to change</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 28, opacity: .15, marginBottom: 8 }}>↑</div>
                    <div style={{ fontSize: 12, color: T1, opacity: .55 }}>Drop your resume here</div>
                    <div style={{ fontSize: 9.5, color: T2, marginTop: 3 }}>PDF, DOCX, or TXT · click to browse</div>
                  </>
                )}
              </div>
            ) : (
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste your resume text here…" rows={8}
                style={{ width: "100%", background: "rgba(255,255,255,.02)", border: `1px solid ${T3}`, borderRadius: 6, padding: "10px", color: T1, fontSize: 11, fontFamily: "Outfit,sans-serif", resize: "vertical", outline: "none", lineHeight: 1.65, boxSizing: "border-box" }} />
            )}
          </div>

          {/* Job description */}
          <div>
            <div style={{ ...sideLabel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Job Description</span>
              {jd.trim() && (
                <button onClick={handleParseJD} disabled={loading} style={{ fontSize: 8.5, color: GOLD, background: "none", border: "none", cursor: loading ? "not-allowed" : "pointer", fontFamily: "Outfit,sans-serif", padding: 0, letterSpacing: .5 }}>
                  {isL("jd") ? "Analyzing…" : "Analyze JD →"}
                </button>
              )}
            </div>
            <textarea value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the target job description here…" rows={8}
              style={{ width: "100%", background: "rgba(255,255,255,.02)", border: `1px solid ${T3}`, borderRadius: 6, padding: 10, color: T1, fontSize: 11, fontFamily: "Outfit,sans-serif", resize: "vertical", outline: "none", lineHeight: 1.65, boxSizing: "border-box" }} />

            {/* JD analysis panel */}
            {showJDPanel && parsedJD && (
              <div style={{ background: "rgba(201,168,80,.04)", border: `1px solid rgba(201,168,80,.2)`, borderRadius: 7, padding: "12px 14px", marginTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: GOLD, fontWeight: 600 }}>
                    {parsedJD.role}{parsedJD.company ? ` @ ${parsedJD.company}` : ""}
                  </div>
                  <button onClick={() => setShowJDPanel(false)} style={{ fontSize: 13, color: T2, background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10 }}>
                  {parsedJD.experience && <div><div style={{ fontSize: 8, color: T2, letterSpacing: 1.5, textTransform: "uppercase" }}>Experience</div><div style={{ fontSize: 10.5, color: T1, marginTop: 2 }}>{parsedJD.experience}</div></div>}
                  {parsedJD.salary && <div><div style={{ fontSize: 8, color: T2, letterSpacing: 1.5, textTransform: "uppercase" }}>Salary</div><div style={{ fontSize: 10.5, color: "#4ade80", marginTop: 2 }}>{parsedJD.salary}</div></div>}
                  {parsedJD.remote && <div><div style={{ fontSize: 8, color: T2, letterSpacing: 1.5, textTransform: "uppercase" }}>Work Style</div><div style={{ fontSize: 10.5, color: T1, marginTop: 2 }}>{parsedJD.remote}</div></div>}
                </div>
                {parsedJD.required?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 8, color: "#f87171", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>Must Have</div>
                    {parsedJD.required.map((r, i) => <div key={i} style={{ fontSize: 10, color: "#f87171", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid rgba(248,113,113,.3)", lineHeight: 1.45 }}>{r}</div>)}
                  </div>
                )}
                {parsedJD.preferred?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 8, color: "#fbbf24", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>Nice to Have</div>
                    {parsedJD.preferred.map((r, i) => <div key={i} style={{ fontSize: 10, color: "#fbbf24", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid rgba(251,191,36,.3)", lineHeight: 1.45 }}>{r}</div>)}
                  </div>
                )}
                {parsedJD.keywords?.length > 0 && (
                  <div>
                    <div style={{ ...sideLabel, marginBottom: 5 }}>ATS Keywords</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {parsedJD.keywords.map((k, i) => <Pill key={i} text={k} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tone selector */}
          <div>
            <div style={sideLabel}>Writing Tone</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[["entry","Entry Level"],["balanced","Professional"],["executive","Executive"]].map(([t, lbl]) => (
                <button key={t} onClick={() => setTone(t)} style={{ padding: "7px 4px", fontSize: 9.5, fontFamily: "Outfit,sans-serif", cursor: "pointer", border: `1px solid ${tone === t ? GOLD : "rgba(255,255,255,.07)"}`, borderRadius: 5, background: tone === t ? "rgba(201,168,80,.1)" : "rgba(255,255,255,.01)", color: tone === t ? GOLD : T2, transition: "all .15s", letterSpacing: .3 }}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Error */}
          {err && <div style={{ fontSize: 11, color: "#f87171", background: "rgba(248,113,113,.06)", border: "1px solid rgba(248,113,113,.18)", borderRadius: 5, padding: "7px 10px", lineHeight: 1.5 }}>{err}</div>}

          {/* Primary actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={handleOptimize} disabled={loading}
              style={{ padding: "13px 0", background: isL("optimize") ? "rgba(201,168,80,.18)" : `linear-gradient(135deg,${GOLD},#9c7b22)`, color: isL("optimize") ? T2 : "#000", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 2.5, textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer", fontFamily: "Outfit,sans-serif", transition: "all .2s" }}>
              {isL("optimize") ? LOADING_MSGS[loadingMsgIdx] : "✦  Optimize Resume"}
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={handleScoreOnly} disabled={loading}
                style={{ padding: "8px 0", background: "transparent", color: isL("score") ? T2 : T1, border: `1px solid ${T3}`, borderRadius: 5, fontSize: 9.5, fontWeight: 500, letterSpacing: 1, textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer", fontFamily: "Outfit,sans-serif" }}>
                {isL("score") ? "Scoring…" : "Score Only"}
              </button>
              <button onClick={handleCoverLetter} disabled={loading || !resume}
                style={{ padding: "8px 0", background: "transparent", color: (!resume || isL("cover")) ? T2 : T1, border: `1px solid ${T3}`, borderRadius: 5, fontSize: 9.5, fontWeight: 500, letterSpacing: 1, textTransform: "uppercase", cursor: (loading || !resume) ? "not-allowed" : "pointer", fontFamily: "Outfit,sans-serif" }}>
                {isL("cover") ? "Writing…" : "Cover Letter"}
              </button>
            </div>
          </div>

          {/* Score-only result */}
          {scoreOnly && !resume && (
            <div style={{ background: "rgba(255,255,255,.015)", border: `1px solid ${T3}`, borderRadius: 8, padding: "18px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
              <ArcGauge score={scoreOnly.atsScore} />
              {scoreOnly.recommendations?.length > 0 && (
                <div>
                  <div style={sideLabel}>Recommendations</div>
                  {scoreOnly.recommendations.map((r, i) => <div key={i} style={{ fontSize: 11, color: "#9de89a", marginBottom: 6, paddingLeft: 9, borderLeft: "2px solid rgba(74,222,128,.2)", lineHeight: 1.5 }}>{r}</div>)}
                </div>
              )}
              {scoreOnly.missingKeywords?.length > 0 && (
                <div>
                  <div style={sideLabel}>Missing Keywords</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {scoreOnly.missingKeywords.map((k, i) => <Pill key={i} text={k} color="#f87171" bg="rgba(248,113,113,.07)" border="rgba(248,113,113,.2)" />)}
                  </div>
                </div>
              )}
              {scoreOnly.gaps?.length > 0 && (
                <div>
                  <div style={sideLabel}>Gaps Found</div>
                  {scoreOnly.gaps.map((g, i) => <div key={i} style={{ fontSize: 11, color: "#fbbf24", marginBottom: 5, paddingLeft: 9, borderLeft: "2px solid rgba(251,191,36,.2)", lineHeight: 1.5 }}>{g}</div>)}
                </div>
              )}
              <button onClick={handleOptimize} disabled={loading} style={{ padding: "9px 0", background: `linear-gradient(135deg,${GOLD},#9c7b22)`, color: "#000", border: "none", borderRadius: 5, fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", fontFamily: "Outfit,sans-serif" }}>
                Now Optimize →
              </button>
            </div>
          )}

          {/* Resume ATS analysis */}
          {resume && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "rgba(255,255,255,.015)", border: `1px solid ${T3}`, borderRadius: 8, padding: "16px 12px" }}>
                <ArcGauge score={resume.atsScore} />
              </div>
              {resume.gaps?.length > 0 && (
                <div>
                  <div style={sideLabel}>Gaps to Address</div>
                  {resume.gaps.map((g, i) => <div key={i} style={{ fontSize: 10.5, color: "#fbbf24", marginBottom: 5, paddingLeft: 9, borderLeft: "2px solid rgba(251,191,36,.2)", lineHeight: 1.5 }}>{g}</div>)}
                </div>
              )}
              {resume.improvements?.length > 0 && (
                <div>
                  <div style={sideLabel}>Improvements Made</div>
                  {resume.improvements.map((imp, i) => <div key={i} style={{ fontSize: 10.5, color: "#9de89a", marginBottom: 5, paddingLeft: 9, borderLeft: "2px solid rgba(74,222,128,.2)", lineHeight: 1.5 }}>{imp}</div>)}
                </div>
              )}
              {resume.addedKeywords?.length > 0 && (
                <div>
                  <div style={sideLabel}>Keywords Added</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{resume.addedKeywords.map((k, i) => <Pill key={i} text={k} />)}</div>
                </div>
              )}
              {resume.matchedKeywords?.length > 0 && (
                <div>
                  <div style={sideLabel}>Keywords Matched</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{resume.matchedKeywords.map((k, i) => <Pill key={i} text={k} color="#4ade80" bg="rgba(74,222,128,.07)" border="rgba(74,222,128,.2)" />)}</div>
                </div>
              )}
            </div>
          )}

          {/* Saved versions */}
          {versions.length > 0 && (
            <div>
              <div style={{ ...sideLabel, display: "flex", justifyContent: "space-between" }}>
                <span>Saved Versions</span>
                <span style={{ color: T2 }}>{versions.length}</span>
              </div>
              {[...versions].reverse().map(ver => (
                <div key={ver.id} style={{ background: "rgba(255,255,255,.02)", border: `1px solid ${T3}`, borderRadius: 5, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: T1, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ver.label}</div>
                    <div style={{ fontSize: 9, color: T2, marginTop: 2 }}>ATS {ver.atsScore || "—"}</div>
                  </div>
                  <button onClick={() => { setResume(ver.resume); setJd(ver.jd || ""); setActiveTab("resume"); }} style={{ fontSize: 9, color: GOLD, background: "none", border: "none", cursor: "pointer", fontFamily: "Outfit,sans-serif", padding: 0, flexShrink: 0 }}>Load</button>
                  <button onClick={() => deleteVersion(ver.id)} style={{ fontSize: 9, color: "#e57373", background: "none", border: "none", cursor: "pointer", fontFamily: "Outfit,sans-serif", padding: 0, flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right content area ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Tab bar */}
          <div style={{ borderBottom: `1px solid ${T3}`, display: "flex", alignItems: "center", padding: "0 18px", flexShrink: 0, background: "rgba(0,0,0,.25)" }}>
            {[["resume","Resume"],["cover","Cover Letter"],["diff","Before / After"],["jobs","Job Search"]].map(([t, lbl]) => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ padding: "12px 14px", fontSize: 11, fontFamily: "Outfit,sans-serif", cursor: "pointer", border: "none", background: "transparent", color: activeTab === t ? T1 : T2, borderBottom: activeTab === t ? `2px solid ${GOLD}` : "2px solid transparent", marginBottom: -1, transition: "all .15s", letterSpacing: .3, fontWeight: activeTab === t ? 500 : 400 }}>
                {lbl}
              </button>
            ))}
            {/* Template switcher */}
            {activeTab === "resume" && resume && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: 9, color: T2, marginRight: 4, letterSpacing: 1 }}>Template</span>
                {[["classic","Classic"],["modern","Modern"],["minimal","Minimal"]].map(([t, lbl]) => (
                  <button key={t} onClick={() => setTemplate(t)}
                    style={{ padding: "4px 10px", fontSize: 9.5, fontFamily: "Outfit,sans-serif", cursor: "pointer", border: `1px solid ${template === t ? GOLD : "rgba(255,255,255,.07)"}`, borderRadius: 3, background: template === t ? "rgba(201,168,80,.1)" : "transparent", color: template === t ? GOLD : T2, transition: "all .15s" }}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Tab: Resume ── */}
          {activeTab === "resume" && (
            <div style={{ flex: 1, overflowY: "auto", background: "#080810", display: "flex", justifyContent: "center", padding: "36px 28px 72px" }}>
              {!resume ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, opacity: .4 }}>
                  <svg width="50" height="62" viewBox="0 0 50 62" fill="none">
                    <rect x="1" y="1" width="48" height="60" rx="3" stroke={GOLD} strokeWidth="1.5"/>
                    <line x1="9" y1="18" x2="41" y2="18" stroke={GOLD} strokeWidth="1" strokeOpacity=".6"/>
                    <line x1="9" y1="26" x2="41" y2="26" stroke={GOLD} strokeWidth="1" strokeOpacity=".4"/>
                    <line x1="9" y1="34" x2="33" y2="34" stroke={GOLD} strokeWidth="1" strokeOpacity=".3"/>
                    <line x1="9" y1="46" x2="41" y2="46" stroke={GOLD} strokeWidth="1" strokeOpacity=".18"/>
                    <line x1="9" y1="54" x2="37" y2="54" stroke={GOLD} strokeWidth="1" strokeOpacity=".18"/>
                  </svg>
                  <div style={{ textAlign: "center", lineHeight: 1.8 }}>
                    <div style={{ fontSize: 13, color: T2 }}>Your optimized resume will appear here</div>
                    <div style={{ fontSize: 10, color: T2, opacity: .6 }}>Upload resume · Paste job description · Optimize</div>
                  </div>
                </div>
              ) : (
                <div style={{ width: "100%", maxWidth: 800, background: "#fff", boxShadow: "0 16px 80px rgba(0,0,0,.75)" }}>
                  <ResComp resume={resume} upd={upd} order={sectionOrder} move={moveSection} />
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Cover Letter ── */}
          {activeTab === "cover" && (
            <div style={{ flex: 1, overflowY: "auto", background: "#080810", display: "flex", justifyContent: "center", padding: "36px 28px 72px" }}>
              {!coverLetter ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14, opacity: .4 }}>
                  <div style={{ fontSize: 40, opacity: .25 }}>✉</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: T2 }}>No cover letter yet</div>
                    <div style={{ fontSize: 10, color: T2, opacity: .7, marginTop: 5 }}>Optimize your resume first, then click "Cover Letter" in the sidebar</div>
                  </div>
                </div>
              ) : (
                <div style={{ width: "100%", maxWidth: 700, background: "#fff", boxShadow: "0 16px 80px rgba(0,0,0,.75)", padding: "60px 64px", fontFamily: "Cormorant Garamond,Georgia,serif", color: "#1a1a1a" }}>
                  <div style={{ fontSize: 11, color: "#bbb", marginBottom: 34, fontFamily: "Outfit,sans-serif" }}>
                    {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </div>
                  {[coverLetter.greeting, coverLetter.opening, coverLetter.body, coverLetter.closing].map((para, i) => (
                    para && <div key={i} style={{ fontSize: 14, lineHeight: 1.9, color: i === 0 ? "#1a1a1a" : "#2a2a2a", marginBottom: i === 0 ? 28 : 20, whiteSpace: "pre-wrap" }}>{para}</div>
                  ))}
                  <div style={{ fontSize: 14, color: "#555", marginTop: 36 }}>{coverLetter.signOff}</div>
                  {resume?.name && <div style={{ fontSize: 17, fontWeight: 600, marginTop: 10 }}>{resume.name}</div>}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Before / After ── */}
          {activeTab === "diff" && (
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Before */}
              <div style={{ flex: 1, borderRight: `1px solid ${T3}`, padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: 2, color: "#f87171", textTransform: "uppercase", marginBottom: 14, fontFamily: "Outfit,sans-serif" }}>Original Resume</div>
                {originalText
                  ? <pre style={{ fontFamily: "Outfit,sans-serif", fontSize: 11, color: T1, lineHeight: 1.75, whiteSpace: "pre-wrap", opacity: .65, margin: 0 }}>{originalText}</pre>
                  : <div style={{ fontSize: 11, color: T2, opacity: .6, lineHeight: 1.7 }}>
                      {file ? `PDF uploaded: ${file.name}\n\nOriginal text not extractable in the diff view.\nThe PDF was sent directly to Claude for analysis.` : "Use 'Paste Text' mode to see the before/after comparison."}
                    </div>
                }
              </div>
              {/* After */}
              <div style={{ flex: 1, padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: 2, color: "#4ade80", textTransform: "uppercase", marginBottom: 14, fontFamily: "Outfit,sans-serif" }}>Optimized Resume</div>
                {resume ? (
                  <div style={{ fontFamily: "Outfit,sans-serif", fontSize: 11, color: T1, lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 3, fontFamily: "Cormorant Garamond,serif" }}>{resume.name}</div>
                    <div style={{ color: GOLD, marginBottom: 12, fontSize: 12.5 }}>{resume.title}</div>
                    {resume.summary && (
                      <div style={{ marginBottom: 18, opacity: .85 }}>
                        <span style={{ color: GOLD, fontWeight: 600, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase" }}>Summary — </span>
                        {resume.summary}
                      </div>
                    )}
                    {resume.experience?.map((exp, i) => (
                      <div key={i} style={{ marginBottom: 15 }}>
                        <div style={{ fontWeight: 600 }}>{exp.role} @ {exp.company}</div>
                        <div style={{ opacity: .5, fontSize: 10, marginBottom: 5 }}>{exp.duration} · {exp.location}</div>
                        {exp.bullets.map((b, bi) => <div key={bi} style={{ paddingLeft: 14, marginBottom: 4, opacity: .8 }}>• {b}</div>)}
                      </div>
                    ))}
                    {resume.skills?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span style={{ color: GOLD, fontWeight: 600, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase" }}>Skills — </span>
                        {resume.skills.join(" · ")}
                      </div>
                    )}
                  </div>
                ) : <div style={{ fontSize: 11, color: T2, opacity: .6 }}>Optimize your resume to see the comparison.</div>}
              </div>
            </div>
          )}

          {/* ── Tab: Job Search ── */}
          {activeTab === "jobs" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>

              {/* Search bar */}
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <input value={jobQuery} onChange={e => setJobQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJobSearch()}
                  placeholder={resume ? `Find roles like: ${resume.title || "your target role"}…` : "Search by job title, skill, or role…"}
                  style={{ flex: 1, background: "rgba(255,255,255,.03)", border: `1px solid ${T3}`, borderRadius: 6, padding: "10px 14px", color: T1, fontSize: 12, fontFamily: "Outfit,sans-serif", outline: "none" }} />
                <button onClick={handleJobSearch} disabled={loading}
                  style={{ padding: "10px 20px", background: isL("jobs") ? "rgba(201,168,80,.2)" : GOLD, color: isL("jobs") ? T2 : "#000", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: "Outfit,sans-serif", letterSpacing: .8 }}>
                  {isL("jobs") ? "Searching…" : "Search"}
                </button>
              </div>

              {/* Bookmarks */}
              {bookmarks.length > 0 && !selectedJob && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ ...sideLabel, marginBottom: 9 }}>Saved Jobs ({bookmarks.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {bookmarks.map(job => (
                      <div key={job.id} onClick={() => setSelectedJob(job)}
                        style={{ background: "rgba(201,168,80,.06)", border: `1px solid rgba(201,168,80,.2)`, borderRadius: 5, padding: "5px 12px", fontSize: 11, color: GOLD, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {job.title} @ {job.company}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Job detail */}
              {selectedJob ? (
                <div>
                  <button onClick={() => setSelectedJob(null)} style={{ fontSize: 10, color: T2, background: "none", border: "none", cursor: "pointer", fontFamily: "Outfit,sans-serif", marginBottom: 18, padding: 0 }}>← Back to results</button>
                  <div style={{ background: "rgba(255,255,255,.02)", border: `1px solid ${T3}`, borderRadius: 10, padding: "26px 24px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 600, color: T1, fontFamily: "Cormorant Garamond,serif", lineHeight: 1.2 }}>{selectedJob.title}</div>
                        <div style={{ fontSize: 13, color: GOLD, marginTop: 5 }}>{selectedJob.company} · {selectedJob.location}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                          <Pill text={selectedJob.type} />
                          {selectedJob.salary && <Pill text={selectedJob.salary} color="#4ade80" bg="rgba(74,222,128,.07)" border="rgba(74,222,128,.2)" />}
                          <span style={{ fontSize: 9.5, color: T2 }}>{selectedJob.posted}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button onClick={() => toggleBookmark(selectedJob)}
                          style={{ fontSize: 10, color: bookmarks.find(b => b.id === selectedJob.id) ? GOLD : T2, background: "none", border: `1px solid ${T3}`, borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontFamily: "Outfit,sans-serif" }}>
                          {bookmarks.find(b => b.id === selectedJob.id) ? "★ Saved" : "☆ Save"}
                        </button>
                        <button onClick={() => { if (resume) { handleReOptimizeWithNewJD(selectedJob.description); } else { setJd(selectedJob.description); setActiveTab("resume"); } }}
                          style={{ fontSize: 10, color: "#000", background: GOLD, border: "none", borderRadius: 4, padding: "6px 16px", cursor: "pointer", fontFamily: "Outfit,sans-serif", fontWeight: 600 }}>
                          {resume ? "Re-optimize →" : "Use This JD →"}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: T1, lineHeight: 1.9, opacity: .85, whiteSpace: "pre-wrap" }}>{selectedJob.description}</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {jobResults.length === 0 && !loading && (
                    <div style={{ textAlign: "center", padding: "70px 0", opacity: .35 }}>
                      <div style={{ fontSize: 40, marginBottom: 14 }}>🔍</div>
                      <div style={{ fontSize: 13, color: T2 }}>Search for jobs above</div>
                      <div style={{ fontSize: 10, color: T2, marginTop: 6, opacity: .7 }}>Claude generates relevant listings tailored to your query and profile</div>
                    </div>
                  )}
                  {jobResults.map(job => (
                    <div key={job.id} onClick={() => setSelectedJob(job)}
                      style={{ background: "rgba(255,255,255,.02)", border: `1px solid ${T3}`, borderRadius: 8, padding: "16px 18px", cursor: "pointer", transition: "border-color .15s" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,168,80,.3)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = T3}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: T1, fontFamily: "Cormorant Garamond,serif" }}>{job.title}</div>
                          <div style={{ fontSize: 11.5, color: GOLD, marginTop: 3 }}>{job.company} · {job.location}</div>
                          <div style={{ fontSize: 11, color: T2, marginTop: 7, lineHeight: 1.55 }}>{job.summary}</div>
                          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                            <Pill text={job.type} />
                            {job.salary && <Pill text={job.salary} color="#4ade80" bg="rgba(74,222,128,.07)" border="rgba(74,222,128,.2)" />}
                            <span style={{ fontSize: 9.5, color: T2 }}>{job.posted}</span>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); toggleBookmark(job); }}
                          style={{ fontSize: 16, color: bookmarks.find(b => b.id === job.id) ? GOLD : T2, background: "none", border: "none", cursor: "pointer", padding: "0 4px", marginLeft: 12, flexShrink: 0 }}>
                          {bookmarks.find(b => b.id === job.id) ? "★" : "☆"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
