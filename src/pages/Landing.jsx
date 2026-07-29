import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PublicFooter, PublicNav } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { getPublicLaunchOffer, getPublicModuleCatalog } from "../lib/appApi";
import { logAppError } from "../lib/errors";
import { formatLaunchOfferEnd, formatModuleMoney } from "../lib/pricing";
import { normalizePublicModules } from "../lib/publicModules";
import { useAuth } from "../lib/useAuth";

function PracticeExperiencePreview() {
  return (
    <aside className="landing-experience-preview" aria-label="Practice experience preview">
      <div className="landing-experience-preview-heading">
        <strong>A timed set, then review.</strong>
      </div>

      <div className="landing-experience-test">
        <div className="landing-experience-test-meta">
          <span>Question 12 of 30</span>
          <strong>18:42</strong>
        </div>
        <div className="landing-experience-progress"><i aria-hidden="true" /></div>
        <div className="landing-experience-question">
          <p>Under which Federal Civil Service reform strategy was the modern Performance Management System introduced as a key pillar?</p>
          <div className="landing-experience-options" aria-label="Example answer choices">
            <div className="is-selected">
              <i aria-hidden="true" />
              <b>A</b>
              <span>Federal Civil Service Strategy and Implementation Plan</span>
              <small>Selected</small>
            </div>
            <div>
              <i aria-hidden="true" />
              <b>B</b>
              <span>1999 Constitution of the Federal Republic of Nigeria</span>
            </div>
            <div>
              <i aria-hidden="true" />
              <b>C</b>
              <span>National Civil Service Reform Plan</span>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-experience-outcomes">
        <article>
          <div className="landing-experience-result-mark" aria-hidden="true">{"\u2713"}</div>
          <div>
            <span>Score</span>
            <strong>Know how you performed</strong>
          </div>
        </article>
        <article>
          <div className="landing-experience-review-mark" aria-hidden="true"><i /><i /></div>
          <div>
            <span>Review</span>
            <strong>See the correct answers</strong>
          </div>
        </article>
      </div>
    </aside>
  );
}

function LandingServicePoints() {
  return (
    <section className="landing-service-points" aria-labelledby="landing-service-points-title">
      <h2 id="landing-service-points-title">What you can do</h2>
      <div>
        <article>
          <span>Timed practice</span>
          <p>Complete objective question sets under exam-style timing.</p>
        </article>
        <article>
          <span>Oral questions</span>
          <p>Practise written responses to oral-style prompts.</p>
        </article>
        <article>
          <span>Answer review</span>
          <p>Review your score and check the correct answers after practice.</p>
        </article>
      </div>
    </section>
  );
}

export default function Landing() {
  const { isAdmin, loading, user } = useAuth();
  const [modules, setModules] = useState(null);
  const [launchOffer, setLaunchOffer] = useState(null);
  const [moduleLoadFailed, setModuleLoadFailed] = useState(false);

  useEffect(() => {
    if (loading || user) return undefined;

    let cancelled = false;

    Promise.all([
      getPublicModuleCatalog(),
      getPublicLaunchOffer().catch((error) => {
        logAppError("Landing launch offer", error);
        return null;
      }),
    ])
      .then(([rows, currentLaunchOffer]) => {
        if (!cancelled) {
          setModules(normalizePublicModules(rows));
          setLaunchOffer(currentLaunchOffer);
        }
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
          <h1>Practice for your public service promotion exam.</h1>
          <p className="landing-experience-summary">
            Timed objective practice, oral questions, scores, and answer review by module.
          </p>
          <Link className="primary-action landing-experience-action" to="/auth?mode=sign-up">Start free practice</Link>
          <p className="landing-experience-free-note"><span aria-hidden="true">{"\u2713"}</span> First practice set is free. No payment required.</p>
          {launchOffer && (
            <div className="landing-launch-offer" role="status">
              <strong>Seven-day launch price</strong>
              <span>
                {launchOffer.has_uniform_regular_price ? "Regular price " : "Regular prices from "}
                <del>{formatModuleMoney(launchOffer.regular_price_kobo, launchOffer.currency)}</del>
                {" "}<b>{formatModuleMoney(launchOffer.discounted_price_kobo, launchOffer.currency)} per module</b>
              </span>
              <small>Available until {formatLaunchOfferEnd(launchOffer.ends_at)} WAT.</small>
            </div>
          )}
          <p className="landing-google-purpose">
            If you choose Google sign-in, we use your name and email only for your PromotionSure account.
            <Link to="/privacy"> Privacy Policy</Link>.
          </p>
        </div>

        <PracticeExperiencePreview />

        <div className="landing-experience-modules" aria-label="Available modules">
          <strong>Modules available</strong>
          {modules === null ? (
            <p className="landing-module-state" role="status">Loading current modules...</p>
          ) : moduleLoadFailed ? (
            <p className="landing-module-state" role="status">Module information is temporarily unavailable.</p>
          ) : modules.length === 0 ? (
            <p className="landing-module-state" role="status">No modules are available right now.</p>
          ) : (
            <div>
              {modules.map((module) => (
                <span className={module.status !== "available" ? "is-coming-soon" : ""} key={module.slug}>
                  {module.name}
                  {module.status === "coming_soon" && <small>Coming soon</small>}
                  {module.status === "paused" && <small>Temporarily paused</small>}
                </span>
              ))}
            </div>
          )}
        </div>

        <LandingServicePoints />
      </section>
      <PublicFooter />
    </main>
  );
}
