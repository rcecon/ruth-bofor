/**
 * Security Rules Verification Spec for Tutoring Availability 約補課～！
 * Validates all 12 Dirty Dozen payloads defined in security_spec.md against firestore.rules.
 */

export interface TestPayload {
  name: string;
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  operation: 'create' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: TestPayload[] = [
  {
    name: '1. Unauthenticated Write',
    auth: null,
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'anon',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '2. Unauthorized Student Google Account Write',
    auth: { uid: 'student123', email: 'student@school.edu.hk', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'student123',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '3. Spoofed Unverified Teacher Email',
    auth: { uid: 'spoof123', email: 'lawhiudak@gmail.com', email_verified: false },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'spoof123',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '4. Shadow Field Injection on Create',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
      studentName: 'Chan Tai Man',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '5. Shadow Field Injection on Update',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'update',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Occupied',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
      notes: 'Extra field',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '6. Invalid Status Enum Value',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Booked',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '7. Invalid TimeSlot Enum Value',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Morning',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '8. Malformed Date String',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '12/10/2026',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '9. Spoofed updatedBy UID',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'otherUserUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '10. Forged Client Timestamp',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: '2020-01-01T00:00:00Z',
      updatedBy: 'teacherUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '11. Mutating Immutable Coordinate Fields on Update',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'update',
    path: '/availability/2026-10-12_lunch',
    data: {
      date: '2026-10-13',
      timeSlot: 'Lunch',
      status: 'Occupied',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '12. Poisoned Document ID',
    auth: { uid: 'teacherUid', email: 'lawhiudak@gmail.com', email_verified: true },
    operation: 'create',
    path: '/availability/2026-10-12$lunch!',
    data: {
      date: '2026-10-12',
      timeSlot: 'Lunch',
      status: 'Available',
      updatedAt: 'SERVER_TIMESTAMP',
      updatedBy: 'teacherUid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
