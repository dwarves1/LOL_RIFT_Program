"use client";

import { useState } from "react";

type ProfileViewer = {
  realName: string | null;
  riotGameName: string | null;
  riotTagline: string | null;
  profileComplete: boolean;
};

export function ProfileModal({
  viewer,
  busy,
  required,
  onClose,
  onSave,
}: {
  viewer: ProfileViewer;
  busy: boolean;
  required: boolean;
  onClose: () => void;
  onSave: (profile: { realName: string; riotGameName: string; riotTagline: string }) => Promise<boolean>;
}) {
  const [realName, setRealName] = useState(viewer.realName ?? "");
  const [riotGameName, setRiotGameName] = useState(viewer.riotGameName ?? "");
  const [riotTagline, setRiotTagline] = useState(viewer.riotTagline ?? "");

  function updateGameName(value: string) {
    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) {
      setRiotGameName(value.slice(0, hashIndex));
      setRiotTagline(value.slice(hashIndex + 1));
      return;
    }
    setRiotGameName(value);
  }

  const valid = realName.trim() && riotGameName.trim() && riotTagline.trim();
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
          <label><span>롤 본계정</span><div className="riot-id-input"><input value={riotGameName} onChange={(event) => updateGameName(event.target.value.replace(/#/g, "#"))} placeholder="게임 이름" maxLength={32} /><b>#</b><input value={riotTagline} onChange={(event) => setRiotTagline(event.target.value.replace(/#/g, "").toUpperCase())} placeholder="KR1" maxLength={16} /></div><small>전체 Riot ID를 첫 칸에 붙여넣어도 자동으로 나뉩니다.</small></label>
          <label><span>실명</span><input value={realName} onChange={(event) => setRealName(event.target.value)} placeholder="홍길동" maxLength={50} /></label>
          <div className="public-name-preview"><span>공개 표시</span><strong>{riotGameName || "본계정"}#{riotTagline || "태그"}({realName || "실명"})</strong></div>
          <p className="profile-notice">본계정과 실명은 팀 명단, 경기 통계, 포인트 순위 등 공개 화면에 표시됩니다.</p>
        </div>
        <footer>
          {!required && <button type="button" className="secondary-button" onClick={onClose}>취소</button>}
          <button type="button" className="primary-button" disabled={busy || !valid} onClick={async () => {
            const ok = await onSave({ realName, riotGameName, riotTagline });
            if (ok) onClose();
          }}>{busy ? "저장 중…" : required ? "프로필 저장하고 시작" : "변경 사항 저장"}</button>
        </footer>
      </section>
    </div>
  );
}
