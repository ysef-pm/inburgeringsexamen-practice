// RateMyDutch analytics — PostHog EU Cloud behind an opt-in consent banner.
// Firestore /api/events (lib/scorecard.js) stays the source of truth for the
// ads-agent kill guard; page scripts mirror the same named events here via
// window.rmdAnalytics for funnels, session replay and device breakdown.
// Design: docs/plans/2026-08-09-posthog-analytics-design.md
!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="an ln init xn Cn Br kn In capture Fn nn calculateEventProperties On register register_once register_for_session unregister unregister_for_session Ln getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync Dn identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty An Rn createPersonProfile setInternalOrTestUser $n yn jn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Tn debug Ur Rt getPageViewId captureTraceFeedback captureTraceMetric pn".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

posthog.init('phc_5Tkl04nv0OFEPm0wZBywI3Z6ziWjfffk7aZ5KbZ7VmD', {
    api_host: 'https://eu.i.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    // Nothing is captured and no cookie is set until the visitor accepts the banner.
    opt_out_capturing_by_default: true,
    loaded: function (ph) {
        identifySubscriber(ph);
        // Recording doesn't reliably auto-start when the SDK boots opted-out,
        // so kick it explicitly once consent is known (respects project controls).
        if (ph.has_opted_in_capturing()) ph.startSessionRecording();
        if (ph.get_explicit_consent_status() === 'pending') whenDomReady(function () { showConsentBanner(ph); });
    },
});

// Pseudonymous join key to Firestore `subscribers` — never the email itself.
function identifySubscriber(ph) {
    try {
        var sid = localStorage.getItem('rmd-scorecard-sid');
        if (sid) ph.identify(sid);
    } catch (e) { /* storage blocked */ }
}

window.rmdAnalytics = {
    capture: function (name, props) {
        try { if (window.posthog) posthog.capture(name, props); } catch (e) {}
    },
    identify: function (id) {
        try { if (id && window.posthog) posthog.identify(String(id)); } catch (e) {}
    },
};

function whenDomReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
}

function showConsentBanner(ph) {
    var bar = document.createElement('div');
    bar.id = 'rmd-consent-banner';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
        '<style>' +
        '#rmd-consent-banner { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;' +
        '  background: #1a2332; color: #fdfcfa; font-family: Georgia, serif; font-size: .95rem;' +
        '  padding: .85rem 1.25rem; display: flex; flex-wrap: wrap; gap: .75rem; align-items: center;' +
        '  justify-content: center; box-shadow: 0 -2px 12px rgba(26,35,50,.35); }' +
        '#rmd-consent-banner p { margin: 0; max-width: 34rem; line-height: 1.45; }' +
        '#rmd-consent-banner a { color: #c9a962; }' +
        '#rmd-consent-banner button { font-family: inherit; font-size: .95rem; border-radius: 5px;' +
        '  padding: .5rem 1.1rem; cursor: pointer; }' +
        '#rmd-consent-accept { background: #d4652a; color: #fdfcfa; border: none; font-weight: 700; }' +
        '#rmd-consent-decline { background: transparent; color: #fdfcfa; border: 1px solid #6b7280; }' +
        '</style>' +
        '<p>We use optional analytics cookies to understand how people use RateMyDutch and improve it' +
        ' — nothing is tracked unless you accept. <a href="/privacy">Privacy policy</a></p>' +
        '<button id="rmd-consent-accept" type="button">Accept</button>' +
        '<button id="rmd-consent-decline" type="button">Decline</button>';
    document.body.appendChild(bar);
    document.getElementById('rmd-consent-accept').onclick = function () {
        ph.opt_in_capturing();
        ph.startSessionRecording();
        identifySubscriber(ph);
        bar.remove();
    };
    document.getElementById('rmd-consent-decline').onclick = function () {
        ph.opt_out_capturing();
        bar.remove();
    };
}
