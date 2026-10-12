/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  AUTHORIZED_TEACHER_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';

export type TimeSlotType = 'Lunch' | 'After School';
export type AvailabilityStatus = 'Available' | 'Occupied' | 'Unavailable';

export interface AvailabilityRecord {
  date: string;
  timeSlot: TimeSlotType;
  status: AvailabilityStatus;
  updatedAt?: unknown;
  updatedBy?: string;
}

const PUBLIC_STATUS_LABELS: Record<AvailabilityStatus, string> = {
  Available: 'Available（可以約！）',
  Occupied: 'Occupied（有人約左我了！）',
  Unavailable: 'No slot available（我唔得閒！）',
};

const TIME_SLOTS: TimeSlotType[] = ['Lunch', 'After School'];
const ALL_STATUSES: AvailabilityStatus[] = ['Available', 'Occupied', 'Unavailable'];

// Blueprint validation constants matching firebase-blueprint.json & firestore.rules
const DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SLOT_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const UID_REGEX = /^[a-zA-Z0-9_\-]+$/;

const MIN_START_DATE_STR = '2026-10-12';

/**
 * Returns the current date in Asia/Hong_Kong time zone as { year, month, day }
 */
function getHongKongTodayParts(): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const formatted = formatter.format(new Date()); // YYYY-MM-DD
  const [year, month, day] = formatted.split('-').map(Number);
  return { year, month, day };
}

/**
 * Computes the Monday of the week for a given UTC calendar date + weekOffset,
 * never returning a week before 2026-10-12.
 */
function getMondayUTC(weekOffset: number): Date {
  const { year, month, day } = getHongKongTodayParts();
  const baseDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = baseDate.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  baseDate.setUTCDate(baseDate.getUTCDate() + diffToMonday + weekOffset * 7);

  const minMonday = new Date(Date.UTC(2026, 9, 12)); // 2026-10-12
  if (baseDate.getTime() < minMonday.getTime()) {
    return minMonday;
  }
  return baseDate;
}

interface DayEntry {
  dateStr: string; // YYYY-MM-DD
  shortDate: string; // e.g. 10-12
  weekday: string; // e.g. Mon
  displayDate: string; // e.g. 2026-10-12 (Mon)
}

function getOneWeekMondayToFriday(weekOffset: number): DayEntry[] {
  const startMonday = getMondayUTC(weekOffset);
  const days: DayEntry[] = [];
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let d = 0; d < 5; d++) {
    const current = new Date(startMonday.getTime());
    current.setUTCDate(startMonday.getUTCDate() + d);
    const yyyy = current.getUTCFullYear();
    const mm = String(current.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(current.getUTCDate()).padStart(2, '0');
    const weekday = weekdayNames[current.getUTCDay()];
    const dateStr = `${yyyy}-${mm}-${dd}`;
    days.push({
      dateStr,
      shortDate: `${mm}-${dd}`,
      weekday,
      displayDate: `${dateStr} (${weekday})`,
    });
  }
  return days;
}

function getSlotDocId(dateStr: string, timeSlot: TimeSlotType): string {
  const suffix = timeSlot === 'Lunch' ? 'lunch' : 'after_school';
  return `${dateStr}_${suffix}`;
}

export default function App() {
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [slotsMap, setSlotsMap] = useState<Record<string, AvailabilityStatus>>({});
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);

  const isAuthorizedTeacher = Boolean(
    user &&
      user.email &&
      user.email.toLowerCase() === AUTHORIZED_TEACHER_EMAIL.toLowerCase() &&
      user.emailVerified
  );

  // Track authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        if (
          currentUser.email?.toLowerCase() === AUTHORIZED_TEACHER_EMAIL.toLowerCase() &&
          currentUser.emailVerified
        ) {
          setAuthError(null);
        } else {
          setAuthError(`Unauthorised account (${currentUser.email}). Only the teacher account can edit.`);
          setIsEditMode(false);
        }
      } else {
        setIsEditMode(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener on /availability collection (publicly readable)
  useEffect(() => {
    const path = 'availability';
    const availabilityQuery = query(
      collection(db, path),
      where('status', 'in', ALL_STATUSES)
    );
    const unsubscribe = onSnapshot(
      availabilityQuery,
      (snapshot) => {
        const nextMap: Record<string, AvailabilityStatus> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<AvailabilityRecord>;
          if (data.date && data.date < MIN_START_DATE_STR) {
            return;
          }
          if (
            data.status === 'Available' ||
            data.status === 'Occupied' ||
            data.status === 'Unavailable'
          ) {
            nextMap[docSnap.id] = data.status;
          }
        });
        setSlotsMap(nextMap);
        setLoadingData(false);
      },
      (error) => {
        setLoadingData(false);
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
    return () => unsubscribe();
  }, []);

  const days = useMemo(() => getOneWeekMondayToFriday(weekOffset), [weekOffset]);

  const handleTeacherEditClick = async () => {
    setAuthError(null);
    if (isAuthorizedTeacher) {
      setIsEditMode((prev) => !prev);
      return;
    }

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const signedInEmail = result.user.email?.toLowerCase();
      if (signedInEmail === AUTHORIZED_TEACHER_EMAIL.toLowerCase() && result.user.emailVerified) {
        setIsEditMode(true);
      } else {
        setAuthError(`Unauthorised Google account (${result.user.email}). Sign out or use the authorised teacher account.`);
        await signOut(auth);
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('auth/popup-closed-by-user')) {
        setAuthError('Sign-in could not be completed. Please try again.');
      }
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    setIsEditMode(false);
    await signOut(auth);
  };

  const handleStatusChange = async (
    dateStr: string,
    timeSlot: TimeSlotType,
    newStatus: AvailabilityStatus
  ) => {
    if (!user || !isAuthorizedTeacher) return;

    const slotId = getSlotDocId(dateStr, timeSlot);

    // Defensive payload validation adhering to firebase-blueprint.json
    if (
      !SLOT_ID_REGEX.test(slotId) ||
      slotId.length > 128 ||
      !DATE_REGEX.test(dateStr) ||
      !TIME_SLOTS.includes(timeSlot) ||
      !ALL_STATUSES.includes(newStatus) ||
      !UID_REGEX.test(user.uid) ||
      user.uid.length > 128
    ) {
      return;
    }

    setSavingSlotId(slotId);
    const path = `availability/${slotId}`;
    try {
      await setDoc(doc(db, 'availability', slotId), {
        date: dateStr,
        timeSlot,
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setSavingSlotId(null);
    }
  };

  const rangeSummary =
    days.length > 0 ? `${days[0].dateStr} — ${days[days.length - 1].dateStr}` : '';
  const canGoPrevWeek = days.length > 0 && days[0].dateStr > MIN_START_DATE_STR;

  return (
    <div className="min-h-screen bg-[#f4faf6] text-[#163024] px-3 py-4 sm:px-6 sm:py-8">
      <div className="max-w-3xl mx-auto">
        {/* Top bar: Small title on left, Teacher Edit button in top-right corner */}
        <header className="flex items-center justify-between gap-2 pb-3 sm:pb-4 mb-4 sm:mb-5 border-b border-[#d4e9dc]">
          <h1 className="text-base sm:text-xl font-semibold tracking-tight text-[#143325] whitespace-nowrap shrink-0">
            Tutoring Availability 約補課～！
          </h1>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isAuthorizedTeacher && (
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[38px] sm:min-h-0 px-2.5 py-1.5 text-xs font-medium text-[#3b5e4c] hover:text-[#143325] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign Out
              </button>
            )}
            <button
              type="button"
              onClick={handleTeacherEditClick}
              className={`min-h-[38px] sm:min-h-0 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isEditMode
                  ? 'bg-[#1f5c3f] text-white border-[#1f5c3f]'
                  : 'bg-[#e6f4ec] text-[#1f5c3f] border-[#c2e2cf] hover:bg-[#d5ecdf]'
              }`}
            >
              {isEditMode ? 'Done Editing' : 'Teacher Edit'}
            </button>
          </div>
        </header>

        {authError && (
          <div className="mb-4 px-3 py-2 text-xs text-[#991b1b] bg-[#fef2f2] border border-[#fecaca] rounded-md">
            {authError}
          </div>
        )}

        {/* Simple week navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            {canGoPrevWeek && (
              <button
                type="button"
                onClick={() => setWeekOffset((prev) => Math.max(0, prev - 1))}
                className="flex-1 sm:flex-initial min-h-[40px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium bg-white text-[#1f4734] border border-[#cce5d6] rounded-md hover:bg-[#eaf6ef] active:bg-[#d8efe2] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ← Prev Week
              </button>
            )}
            <button
              type="button"
              onClick={() => setWeekOffset((prev) => prev + 1)}
              className="flex-1 sm:flex-initial min-h-[40px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium bg-white text-[#1f4734] border border-[#cce5d6] rounded-md hover:bg-[#eaf6ef] active:bg-[#d8efe2] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Next Week →
            </button>
            {weekOffset > 0 && (
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="min-h-[40px] sm:min-h-0 px-2.5 py-2 sm:py-1.5 text-xs font-medium text-[#2c6649] bg-[#e6f4ec] sm:bg-transparent rounded-md sm:rounded-none hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Current Week
              </button>
            )}
          </div>

          <span className="text-xs text-[#466b58] font-mono-tabular text-center sm:text-right whitespace-nowrap">
            {rangeSummary}
          </span>
        </div>

        {/* Simple, compact timetable */}
        <div className="bg-white border border-[#cce5d6] rounded-lg overflow-hidden shadow-xs">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="bg-[#e8f5ed] border-b border-[#cce5d6] text-[#1c4230]">
                <th className="py-2.5 px-2.5 sm:px-4 font-semibold text-xs w-[26%] sm:w-auto">Date</th>
                <th className="py-2.5 px-2.5 sm:px-4 font-semibold text-xs w-[28%] sm:w-auto">Time slot</th>
                <th className="py-2.5 px-2.5 sm:px-4 font-semibold text-xs">Availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dfeee5]">
              {days.map((day, dayIndex) =>
                TIME_SLOTS.map((timeSlot, slotIndex) => {
                  const slotId = getSlotDocId(day.dateStr, timeSlot);
                  const status: AvailabilityStatus = slotsMap[slotId] ?? 'Available';
                  const isFirstSlotOfDay = slotIndex === 0;
                  const isNewDayAfterFirst = dayIndex > 0 && isFirstSlotOfDay;
                  // Subtle pastel green row distinction between Lunch (crisp white) and After School (soft mint tint)
                  const rowBgClass = isFirstSlotOfDay
                    ? 'bg-white hover:bg-[#f2faf5]'
                    : 'bg-[#f4fbf7] hover:bg-[#ebf7f0]';

                  return (
                    <tr
                      key={slotId}
                      className={`${
                        isNewDayAfterFirst ? 'border-t-2 border-t-[#c5e2d0]' : ''
                      } ${rowBgClass} transition-colors`}
                    >
                      {isFirstSlotOfDay && (
                        <td
                          rowSpan={2}
                          className="py-3 px-2.5 sm:px-4 font-mono-tabular text-xs sm:text-sm text-[#1e3f2f] align-middle bg-[#eef8f2] border-r border-[#d8ece0]"
                        >
                          <span className="hidden sm:inline whitespace-nowrap">
                            {day.displayDate}
                          </span>
                          <div className="flex flex-col sm:hidden leading-tight">
                            <span className="font-semibold text-[#163024]">{day.shortDate}</span>
                            <span className="text-[11px] text-[#466b58]">({day.weekday})</span>
                          </div>
                        </td>
                      )}
                      <td className="py-3 px-2.5 sm:px-4 text-xs sm:text-sm text-[#274d3a] whitespace-nowrap align-middle border-r border-[#e6f2eb] sm:border-r-0">
                        {timeSlot}
                      </td>
                      <td className="py-2.5 px-2.5 sm:px-4 text-xs sm:text-sm align-middle">
                        {loadingData ? (
                          <span className="text-[#6c8f7d] text-xs">Loading...</span>
                        ) : isEditMode && isAuthorizedTeacher ? (
                          <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-stretch sm:items-center gap-1.5">
                            {ALL_STATUSES.map((option) => {
                              const active = status === option;
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  disabled={savingSlotId === slotId}
                                  onClick={() =>
                                    handleStatusChange(day.dateStr, timeSlot, option)
                                  }
                                  className={`min-h-[34px] sm:min-h-0 px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer text-center ${
                                    active
                                      ? option === 'Available'
                                        ? 'bg-[#1f6f46] text-white border-[#1f6f46]'
                                        : option === 'Occupied'
                                        ? 'bg-[#b45309] text-white border-[#b45309]'
                                        : 'bg-[#4b5563] text-white border-[#4b5563]'
                                      : 'bg-white text-[#2f5240] border-[#cce5d6] hover:bg-[#edf7f1] active:bg-[#dfeee5]'
                                  }`}
                                >
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span
                            className={`block leading-snug font-medium break-words ${
                              status === 'Available'
                                ? 'text-[#156c3f]'
                                : status === 'Occupied'
                                ? 'text-[#9a3412]'
                                : 'text-[#64748b]'
                            }`}
                          >
                            {PUBLIC_STATUS_LABELS[status]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
