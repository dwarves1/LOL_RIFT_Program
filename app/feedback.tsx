"use client";

import { useEffect, useId, useRef, useState } from "react";

export type FeedbackCategory = "issue" | "idea" | "question" | "other";
export type FeedbackStatus = "new" | "reviewed" | "completed";

export type FeedbackEntry = {
  id: string;
  userId: string;
  tournamentId: string | null;
  tournamentName: string | null;
  category: FeedbackCategory;
  message: string;
  pagePath: string;
  status: FeedbackStatus;
  adminNote: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
  reporterName: string;
  reporterEmail: string;
};

type Command = (payload: Record<string, unknown>, successMessage: string) => Promise<boolean>;

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  issue: "오류 신고",
  idea: "기능 제안",
  question: "이용 문의",
  other: "기타",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "새 의견",
  reviewed: "확인함",
  completed: "처리 완료",
};

function formatFeedbackDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FeedbackWidget({
  viewer,
  tournament,
  signInPath,
  busy,
  command,
}: {
  viewer: { id: string } | null;
  tournament: { id: string; name: string } | null;
  signInPath: string;
  busy: boolean;
  command: Command;
}) {
  const panelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open || !viewer) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, viewer]);

  async function submit() {
    const trimmed = message.trim();
    if (trimmed.length < 10 || busy) return;
    const ok = await command({
      action: "submit_feedback",
      input: {
        tournamentId: tournament?.id ?? null,
        category,
        message: trimmed,
        pagePath: `${window.location.pathname}${window.location.search}`,
      },
    }, "의견이 운영자에게 전달되었습니다. 소중한 의견 감사합니다.");
    if (ok) {
      setMessage("");
      setCategory("idea");
      setOpen(false);
    }
  }

  return <div className={`feedback-widget ${open ? "open" : ""}`}>
    {open && <section id={panelId} className="feedback-popover" role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`}>
      <header>
        <div><span>FEEDBACK</span><h2 id={`${panelId}-title`}>의견 보내기</h2></div>
        <button type="button" onClick={() => setOpen(false)} aria-label="의견 보내기 닫기">×</button>
      </header>
      {viewer ? <>
        <p className="feedback-guide">운영자에게 의견을 보내는 기능입니다. 실시간 대화나 답변 기능은 제공하지 않습니다.</p>
        <label className="feedback-field"><span>의견 종류</span><select value={category} disabled={busy} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>{Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="feedback-field"><span>내용</span><textarea ref={textareaRef} value={message} disabled={busy} maxLength={1000} rows={6} placeholder="불편했던 점이나 필요한 기능을 자세히 알려주세요. (10자 이상)" onChange={(event) => setMessage(event.target.value)} /></label>
        <div className="feedback-meta"><span>{tournament?.name ?? "대회 선택 전"}</span><b>{message.length.toLocaleString()}/1,000</b></div>
        <button type="button" className="primary-button feedback-submit" disabled={busy || message.trim().length < 10} onClick={() => void submit()}>의견 보내기</button>
      </> : <div className="feedback-signin">
        <p>Google 로그인 후 오류나 기능 제안을 운영자에게 보낼 수 있습니다. Riot 계정 등록은 필요하지 않습니다.</p>
        <a className="primary-button" href={signInPath}>Google 로그인</a>
      </div>}
    </section>}
    <button type="button" className="feedback-launcher" aria-label={open ? "의견 보내기 닫기" : "의견 보내기 열기"} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
      <span className="feedback-bubble-glyph" aria-hidden="true"><i /><i /><i /></span>
      <b>의견 보내기</b>
    </button>
  </div>;
}

export function FeedbackAdminPanel({ data, busy, command }: {
  data: { feedback: FeedbackEntry[]; unreadFeedbackCount: number };
  busy: boolean;
  command: Command;
}) {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | "all">("all");
  const visible = data.feedback.filter((feedback) =>
    (statusFilter === "all" || feedback.status === statusFilter)
    && (categoryFilter === "all" || feedback.category === categoryFilter));

  return <article className="panel feedback-admin-panel">
    <div className="section-heading"><div><p className="eyebrow">USER FEEDBACK</p><h2>피드백 관리</h2></div><span className={data.unreadFeedbackCount ? "feedback-unread" : ""}>새 의견 {data.unreadFeedbackCount}건</span></div>
    <p className="admin-panel-help">로그인 사용자가 보낸 오류 신고와 기능 제안입니다. 작성자 정보와 내용은 관리자에게만 표시됩니다.</p>
    <div className="feedback-filters">
      <label><span>처리 상태</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FeedbackStatus | "all")}><option value="all">전체 상태</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>의견 종류</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as FeedbackCategory | "all")}><option value="all">전체 종류</option>{Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <b>{visible.length}건 표시</b>
    </div>
    <div className="feedback-admin-list">
      {visible.map((feedback) => <FeedbackAdminItem key={`${feedback.id}:${feedback.updatedAt}`} feedback={feedback} busy={busy} command={command} />)}
      {!visible.length && <div className="feedback-admin-empty">조건에 맞는 피드백이 없습니다.</div>}
    </div>
  </article>;
}

function FeedbackAdminItem({ feedback, busy, command }: { feedback: FeedbackEntry; busy: boolean; command: Command }) {
  const [open, setOpen] = useState(feedback.status === "new");
  const [status, setStatus] = useState<FeedbackStatus>(feedback.status);
  const [adminNote, setAdminNote] = useState(feedback.adminNote ?? "");
  const changed = status !== feedback.status || adminNote.trim() !== (feedback.adminNote ?? "");
  return <details className={`feedback-admin-item ${feedback.status}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className={`feedback-status ${feedback.status}`}>{STATUS_LABEL[feedback.status]}</span>
      <b>{CATEGORY_LABEL[feedback.category]}</b>
      <strong>{feedback.message}</strong>
      <time>{formatFeedbackDate(feedback.createdAt)}</time>
    </summary>
    <div className="feedback-admin-detail">
      <div className="feedback-reporter"><span><b>{feedback.reporterName}</b><small>{feedback.reporterEmail}</small></span><span><b>{feedback.tournamentName ?? "대회 선택 전"}</b><a href={feedback.pagePath} target="_blank" rel="noreferrer">작성 화면 열기 ↗</a></span></div>
      <p>{feedback.message}</p>
      <div className="feedback-admin-controls">
        <label><span>처리 상태</span><select value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as FeedbackStatus)}>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>관리자 내부 메모</span><textarea value={adminNote} disabled={busy} maxLength={1000} rows={3} placeholder="처리 내용이나 확인할 사항을 기록하세요." onChange={(event) => setAdminNote(event.target.value)} /></label>
        <button type="button" className="secondary-button" disabled={busy || !changed} onClick={() => void command({ action: "update_feedback", feedbackId: feedback.id, status, adminNote }, "피드백 처리 상태를 저장했습니다.")}>상태·메모 저장</button>
      </div>
    </div>
  </details>;
}
