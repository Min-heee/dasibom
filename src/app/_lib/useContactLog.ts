"use client";

/**
 * 이 브라우저의 연락 기록(src/demo/storage.ts). **기본 저장소는 이 모듈의 메모리 변수**이고, localStorage는 쓸 수 있을 때만 맞춰 둔다.
 * 한창구 useDemoState와 같은 구조다: 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 이번 방문 동안은 버튼이 먹통이 되지 않고,
 * 새로 고치면 사라질 뿐이다(띠에 한 번 알린다).
 *
 * useSyncExternalStore를 쓰는 이유: 정적으로 미리 그린 화면(기록 없음)과 브라우저의 저장값이 달라도 하이드레이션이 깨지지 않고,
 * 목록·환자 화면·띠가 같은 값을 본다.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_LOG, undoLastFor, type ContactLog } from "@/core/contact";
import type { Booking, ContactResult, Patient } from "@/core/patient";
import { mustDemo } from "@/demo/data";
import { parseLog, recordDemo, serializeLog, STORAGE_KEY } from "@/demo/storage";

const listeners = new Set<() => void>();
/** undefined = 아직 안 읽음. */
let memory: string | null | undefined;
let storageBlocked = false;

function notify() {
  listeners.forEach((l) => l());
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  memory = e.newValue;
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function snapshot(): string | null {
  if (memory === undefined) {
    try {
      memory = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      memory = null;
      storageBlocked = true;
    }
  }
  return memory;
}

function write(v: string | null) {
  memory = v;
  try {
    if (v === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    storageBlocked = true;
  }
  notify();
}

export interface ContactLogApi {
  log: ContactLog;
  /** 저장돼 있던 기록이 지금 데이터와 맞지 않아 버렸음. */
  dropped: boolean;
  /** 합성 데이터 원본(연락을 더하기 전). 화면은 demo/screen의 todayFor·patientFor에 log와 함께 넘긴다. */
  base: readonly Patient[];
  /** 적은 결과. 이 환자에게 이미 적은 결과가 있으면 바꾼다(replaced). 실패하면 error. 예약 잡음은 booking을 함께 넘긴다. */
  record: (patientId: string, result: ContactResult, booking?: Booking) => { error: string | null; replaced: boolean };
  undo: (patientId: string) => void;
  reset: () => void;
}

export function useContactLog(): ContactLogApi {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const base = mustDemo().patients;
  // parseLog는 예외를 던지지 않는다(모양 검사 + try/catch). 저장값이 깨져도 띠·화면이 멈추지 않고 비운다.
  const { log, dropped } = useMemo(() => parseLog(raw, base), [raw, base]);
  const record = useCallback(
    (patientId: string, result: ContactResult, booking?: Booking) => {
      const cur = parseLog(snapshot(), base).log;
      const r = recordDemo(base, cur, patientId, result, booking);
      if (!r.ok) return { error: r.error, replaced: false };
      write(serializeLog(r.log));
      return { error: null, replaced: r.replaced };
    },
    [base],
  );
  const undo = useCallback(
    (patientId: string) => {
      const cur = parseLog(snapshot(), base).log;
      const u = undoLastFor(cur, patientId);
      write(u.log.applied.length === 0 ? null : serializeLog(u.log));
    },
    [base],
  );
  const reset = useCallback(() => write(null), []);
  return { log: log ?? EMPTY_LOG, dropped, base, record, undo, reset };
}

export function useStorageBlocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      snapshot();
      return storageBlocked;
    },
    () => false,
  );
}
