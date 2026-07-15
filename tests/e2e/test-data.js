export const TEST_PASSWORD = "LocalTestOnly!2026";

export const TEST_USERS = {
  admin: {
    email: "content.admin@example.test",
    fullName: "Content Admin",
  },
  paid: {
    email: "paid.candidate@example.test",
    fullName: "Paid Candidate",
    organizationName: "Federal Ministry of Works",
    phoneNumber: "08012345678",
    stateCode: "Lagos",
  },
  free: {
    email: "free.candidate@example.test",
    fullName: "Free Candidate",
  },
};

export const AUTH_FILES = {
  admin: ".playwright-auth/admin.json",
  paid: ".playwright-auth/paid.json",
  free: ".playwright-auth/free.json",
};
