import assert from "node:assert/strict";
import test from "node:test";

import {
  findSupportFaqs,
  getAdminSupportGuidance,
  SUPPORT_FAQS,
  SUPPORT_TOPICS,
} from "../../src/lib/supportKnowledge.js";

test("support knowledge has unique FAQ ids and valid categories", () => {
  const topicIds = new Set(SUPPORT_TOPICS.map((topic) => topic.id));
  const faqIds = SUPPORT_FAQS.map((faq) => faq.id);

  assert.equal(new Set(faqIds).size, faqIds.length);
  assert.ok(SUPPORT_FAQS.length >= 20);
  for (const faq of SUPPORT_FAQS) {
    assert.ok(topicIds.has(faq.category), `Unknown category: ${faq.category}`);
    assert.ok(faq.question.length > 5);
    assert.ok(faq.answer.length > 20);
    assert.ok(faq.escalation.length > 10);
    assert.ok(faq.requestTitle.length >= 5 && faq.requestTitle.length <= 120);
  }
});

test("FAQ search crosses topics and normal topic browsing stays scoped", () => {
  const paymentResults = findSupportFaqs({ topic: "payment" });
  assert.ok(paymentResults.length >= 4);
  assert.ok(paymentResults.every((faq) => faq.category === "payment"));

  const searchResults = findSupportFaqs({ topic: "account", query: "00:00" });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, "timer-zero-blinking");
});

test("every support category provides actionable admin handling guidance", () => {
  for (const category of ["account", "access", "payment", "practice", "content", "technical"]) {
    const guidance = getAdminSupportGuidance(category);
    assert.ok(guidance.safety.length > 20);
    assert.equal(guidance.checks.length, 3);
    assert.ok(guidance.escalate.length > 20);
  }
});
