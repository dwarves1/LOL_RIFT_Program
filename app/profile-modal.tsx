"use client";

import { useState } from "react";

type ProfileViewer = {
  realName: string | null;
  riotGameName: string | null;
  riotTagline: string | null;
  profileComplete: boolean;
};
type RiotAccountDraft = { id?: string; gameName: string; tagline: string; isPrimary: boolean };

export function ProfileModal({
  viewer,
  riotAccounts,
  busy,
  required,
  onClose,
  onSave,
}: {
  viewer: ProfileViewer;
  riotAccounts: RiotAccountDraft[];
  busy: boolean;
  required: boolean;
  onClose: () => void;
  onSave: (profile: { realName: string; riotGameName: string; riotTagline: string; riotAccounts: RiotAccountDraft[] }) => Promise<boolean>;
}) {
  const [realName, setRealName] = useState(viewer.realName ?? "");
  const [accounts, setAccounts] = useState<RiotAccountDraft[]>(riotAccounts.length ? riotAccounts : [{ gameName: viewer.riotGameName ?? "", tagline: viewer.riotTagline ?? "", isPrimary: true }]);
  const primary = accounts.find((account) => account.isPrimary) ?? accounts[0];

  function patchAccount(index: number, patch: Partial<RiotAccountDraft>) {
    setAccounts((current) => current.map((account, accountIndex) => accountIndex === index ? { ...account, ...patch } : account));
  }
  function updateGameName(index: number, value: string) {
    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) {
      patchAccount(index, { gameName: value.slice(0, hashIndex), tagline: value.slice(hashIndex + 1).replace(/#/g, "").toUpperCase() });
      return;
    }
    patchAccount(index, { gameName: value });
  }

  const valid = realName.trim() && accounts.length > 0 && accounts.length <= 5 && accounts.filter((account) => account.isPrimary).length === 1 && accounts.every((account) => account.gameName.trim() && account.tagline.trim());
  return (
    <div className="modal-backdrop profile-backdrop" role="presentation" onMouseDown={(event) => {
      if (!required && event.currentTarget === event.target) onClose();
    }}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header>
          <div><p className="eyebrow">PLAYER IDENTITY</p><h2 id="profile-title">{required ? "첫 로그인 프로필 설정" : "내 프로필 수정"}</h2></div>
          {!required && <button type="button" onClick={onClose} aria-label="닫기">×</button>}
        </header>
        <div className="profile-modal-body">
          <p className="profile-intro">대회 결과와 포인트 순위에는 본계정과 실명이 함께 표시됩니다.</p>
          <div className="riot-account-editor"><div className="riot-account-heading"><strong>롤 계정</strong><span>본계정 1개 필수 · 부계정 최대 4개</span></div>{accounts.map((account, index) => <div className="riot-account-row" key={account.id ?? index}><label><span>{account.isPrimary ? "본계정" : `부계정 ${index}`}</span><div className="riot-id-input"><input value={account.gameName} onChange={(event) => updateGameName(index, event.target.value)} placeholder="게임 이름" maxLength={32} /><b>#</b><input value={account.tagline} onChange={(event) => patchAccount(index, { tagline: event.target.value.replace(/#/g, "").toUpperCase() })} placeholder="KR1" maxLength={16} /></div></label><div><button type="button" className={account.isPrimary ? "selected" : ""} onClick={() => setAccounts((current) => current.map((item, itemIndex) => ({ ...item, isPrimary: itemIndex === index })))}>{account.isPrimary ? "본계정" : "본계정 지정"}</button>{accounts.length > 1 && <button type="button" onClick={() => setAccounts((current) => { const next = current.filter((_, itemIndex) => itemIndex !== index); if (account.isPrimary && next[0]) next[0] = { ...next[0], isPrimary: true }; return next; })}>삭제</button>}</div></div>)}{accounts.length < 5 && <button type="button" className="secondary-button compact" onClick={() => setAccounts((current) => [...current, { gameName: "", tagline: "", isPrimary: false }])}>＋ 부계정 추가</button>}<small>전체 Riot ID를 게임 이름 칸에 붙여넣어도 자동으로 나뉩니다.</small></div>
          <label><span>실명</span><input value={realName} onChange={(event) => setRealName(event.target.value)} placeholder="홍길동" maxLength={50} /></label>
          <div className="public-name-preview"><span>공개 표시</span><strong>{primary?.gameName || "본계정"}#{primary?.tagline || "태그"}({realName || "실명"})</strong></div>
          <p className="profile-notice">본계정과 실명은 팀 명단, 경기 통계, 포인트 순위 등 공개 화면에 표시됩니다.</p>
        </div>
        <footer>
          {!required && <button type="button" className="secondary-button" onClick={onClose}>취소</button>}
          <button type="button" className="primary-button" disabled={busy || !valid} onClick={async () => {
            if (!primary) return;
            const ok = await onSave({ realName, riotGameName: primary.gameName, riotTagline: primary.tagline, riotAccounts: accounts });
            if (ok) onClose();
          }}>{busy ? "저장 중…" : required ? "프로필 저장하고 시작" : "변경 사항 저장"}</button>
        </footer>
      </section>
    </div>
  );
}
