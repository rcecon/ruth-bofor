# Security Specification: Tutoring Availability 約補課～！

## 1. Data Invariants
1. **Public Readability of Availability Only**: Students can view `/availability/{slotId}` documents (`get` and `list`) without signing in (`true`), ensuring only non-sensitive availability fields (`date`, `timeSlot`, `status`, `updatedAt`, `updatedBy`) are stored.
2. **Exclusive Teacher Write Authority**: Only the explicitly authorized teacher Google account (`lawhiudak@gmail.com` with `request.auth.token.email_verified == true`) or a document in `/admins/{uid}` can `create`, `update`, or `delete` documents in `/availability/{slotId}`.
3. **Strict Schema & Key Validation**: Every `AvailabilitySlot` write must contain ONLY the keys `['date', 'timeSlot', 'status', 'updatedAt', 'updatedBy']`, match exact string bounds and regex patterns from `firebase-blueprint.json`, enforce `updatedBy == request.auth.uid`, and enforce `updatedAt == request.time`.
4. **Path Variable Hardening**: Document ID `{slotId}` must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null`, creating `/availability/2026-10-12_lunch` -> `PERMISSION_DENIED`.
2. **Unauthorized Student Google Account Write**: `auth = { uid: 'student1', token: { email: 'student@school.edu.hk', email_verified: true } }` -> `PERMISSION_DENIED`.
3. **Spoofed Unverified Teacher Email**: `auth = { uid: 'spoof1', token: { email: 'lawhiudak@gmail.com', email_verified: false } }` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Create**: Authorized teacher sends `{ date: '2026-10-12', timeSlot: 'Lunch', status: 'Available', updatedAt: request.time, updatedBy: uid, studentName: 'Chan Tai Man' }` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Update**: Authorized teacher updates existing slot with an extra field `{ notes: 'secret' }` -> `PERMISSION_DENIED`.
6. **Invalid Status Enum Value**: Authorized teacher sets `status: 'Booked'` (not in `['Available', 'Occupied', 'Unavailable']`) -> `PERMISSION_DENIED`.
7. **Invalid TimeSlot Enum Value**: Authorized teacher sets `timeSlot: 'Morning'` (not in `['Lunch', 'After School']`) -> `PERMISSION_DENIED`.
8. **Malformed Date String**: Authorized teacher sets `date: '12/10/2026'` (fails `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`) -> `PERMISSION_DENIED`.
9. **Spoofed updatedBy UID**: Authorized teacher sets `updatedBy: 'another_uid'` instead of `request.auth.uid` -> `PERMISSION_DENIED`.
10. **Forged Client Timestamp**: Authorized teacher sets `updatedAt` to a past or future timestamp instead of `request.time` -> `PERMISSION_DENIED`.
11. **Mutating Immutable Coordinate Fields on Update**: Authorized teacher updates `date` or `timeSlot` of an existing slot document -> `PERMISSION_DENIED`.
12. **Poisoned Document ID**: Authorized teacher creates a document with ID containing spaces or special characters `/availability/2026-10-12$lunch!` -> `PERMISSION_DENIED`.
