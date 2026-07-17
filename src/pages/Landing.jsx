import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PublicNav } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { getPublicModuleCatalog } from "../lib/appApi";
import { logAppError } from "../lib/errors";
import { normalizePublicModules } from "../lib/publicModules";
import { useAuth } from "../lib/useAuth";

function PracticeExperiencePreview() {
  return (
    <aside className="landing-experience-preview" aria-label="Practice experience preview">
      <div className="landing-experience-preview-heading">
        <span>Practice experience</span>
        <strong>Focused from start to review</strong>
      </div>

      <div className="landing-experience-test">
        <div className="landing-experience-test-meta">
          <span>Question 12 of 30</span>
          <strong>18:42 left</strong>
        </div>
        <div className="landing-experience-progress"><i aria-hidden="true" /></div>
        <div className="landing-experience-question">
          <p>Which record helps an office account for money received and spent?</p>
          <div className="landing-experience-options" aria-label="Example answer choices">
            <div className="is-selected">
              <i aria-hidden="true" />
              <b>A</b>
              <span>A financial record</span>
              <small>Selected</small>
            </div>
            <div>
              <i aria-hidden="true" />
              <b>B</b>
              <span>A leave roster</span>
            </div>
            <div>
              <i aria-hidden="true" />
              <b>C</b>
              <span>A staff identity card</span>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-experience-outcomes">
        <article>
          <div className="landing-experience-result-mark" aria-hidden="true">✓</div>
          <div>
            <span>Clear results</span>
            <strong>See your score after submitting</strong>
          </div>
        </article>
        <article>
          <div className="landing-experience-review-mark" aria-hidden="true"><i /><i /></div>
          <div>
            <span>Answer review</span>
            <strong>Understand every answer</strong>
          </div>
        </article>
      </div>
    </aside>
  );
}

export default function Landing() {
  const { isAdmin, loading, user } = useAuth();
  const [modules, setModules] = useState(null);
  const [moduleLoadFailed, setModuleLoadFailed] = useState(false);

  useEffect(() => {
    if (loading || user) return undefined;

    let cancelled = false;

    getPublicModuleCatalog()
      .then((rows) => {
        if (!cancelled) setModules(normalizePublicModules(rows));
      })
      .catch((error) => {
        logAppError("Landing public module catalog", error);
        if (!cancelled) {
          setModules([]);
          setModuleLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (user) {
    return <Navigate to={isAdmin ? "/admin" : "/dashboard"} replace />;
  }

  return (
    <main className="marketing-shell landing-experience-page">
      <PublicNav sticky={false} />

      <section className="landing-experience-hero">
        <div className="landing-experience-copy">
          <h1>Practise for your 2026 public service promotion exam.</h1>
          <p className="landing-experience-summary">
            Choose a module and build steady progress from one practice test to the next.
          </p>
          <Link className="primary-action landing-experience-action" to="/auth?mode=sign-up">Start free practice</Link>
          <p className="landing-experience-free-note"><span aria-hidden="true">✓</span> Your first practice test in one module is free. No payment required.</p>
        </div>

        <PracticeExperiencePreview />

        <div className="landing-experience-modules" aria-label="Current modules">
          <strong>Current modules</strong>
          {modules === null ? (
            <p className="landing-module-state" role="status">Loading current modules...</p>
          ) : moduleLoadFailed ? (
            <p className="landing-module-state" role="status">Module information is temporarily unavailable.</p>
          ) : modules.length === 0 ? (
            <p className="landing-module-state" role="status">No modules are available right now.</p>
          ) : (
            <div>
              {modules.map((module) => (
                <span className={module.status === "coming_soon" ? "is-coming-soon" : ""} key={module.slug}>
                  {module.name}
                  {module.status === "coming_soon" && <small>Coming soon</small>}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
