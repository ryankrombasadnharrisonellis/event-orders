// @ts-nocheck
/**
 * DNA Life / Nordic Health order website
 * --------------------------------------
 * Serves the order page, the staff page and the lab page on our own address (Railway),
 * instead of inside Google's Apps Script frame. That frame is what blocked the camera.
 *
 * The Google Sheet + Apps Script stay the "back office": every action on the page
 * (place order, check payment, save barcode, staff search, ...) is passed on to the
 * Apps Script web app (Api.gs ▸ doPost) with a shared secret. Orders still land in
 * the Orders tab exactly as before.
 *
 * Environment variables (Railway ▸ Variables):
 *   APPS_SCRIPT_URL     the Apps Script web app link (ends in /exec)
 *   APPS_SCRIPT_SECRET  same text as API_SECRET in Apps Script ▸ Project Settings ▸ Script properties
 *   SESSION_SECRET      any long random text (signs the staff login cookie)
 *   STAFF_SESSION_HOURS optional, how long a staff login lasts (default 12)
 *   PORT                set by Railway
 * Without APPS_SCRIPT_URL the site runs in preview mode with demo data (nothing saved).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-nocheck
const EMBEDDED_FILES: Record<string, string> = {
"gas-shim.js": `/* Lets the page keep calling google.script.run.someFunction(arg), as it did inside Apps Script.
   On our own website each call goes to /api/someFunction, and the server passes it on to Apps Script.
   Only installed when the server filled in the page's data (so opening the file directly still shows the demo). */
(function () {
  var boot = document.getElementById("boot");
  try { if (!boot || !JSON.parse(boot.textContent)) return; } catch (e) { return; }

  var staffMode = /^\\/(staff|lab)(\\/|$)/.test(location.pathname);

  function post(fn, arg) {
    var headers = { "Content-Type": "application/json" };
    if (staffMode) headers["X-Staff-Mode"] = "1";
    return fetch("/api/" + encodeURIComponent(fn), {
      method: "POST", headers: headers, credentials: "same-origin",
      body: JSON.stringify({ arg: arg === undefined ? null : arg })
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "The server didn't answer properly (" + r.status + "). Please try again." }; });
    }, function () {
      return { ok: false, error: "No connection. Check the internet connection and try again." };
    }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || "Something went wrong. Please try again.");
      return d.result;
    });
  }

  function runner(onOk, onFail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === "withSuccessHandler") return function (h) { return runner(h, onFail); };
        if (name === "withFailureHandler") return function (h) { return runner(onOk, h); };
        if (typeof name !== "string") return undefined;
        return function (arg) {
          post(name, arg).then(function (r) { if (onOk) onOk(r); }, function (e) { if (onFail) onFail(e); else console.error(e); });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = {
    run: runner(null, null),
    history: {
      // Same idea as Apps Script's history.replace: swap the query string without reloading.
      replace: function (state, params) {
        var u = new URL(location.href);
        u.search = new URLSearchParams(params || {}).toString();
        history.replaceState(state, "", u.toString());
      }
    }
  };
})();
`,
"img/sample-1.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img"><rect width="320" height="220" rx="16" fill="#EEF4FA"/><rect x="50" y="48" width="228" height="132" rx="10" fill="#000" opacity=".08"/><rect x="46" y="42" width="228" height="132" rx="10" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><text x="62" y="66" font-family="Lexend,Arial,sans-serif" font-size="11" font-weight="700" fill="#2F6DB3" letter-spacing="1">BACK OF CARD</text><text x="62" y="96" font-family="Open Sans,Arial,sans-serif" font-size="12" fill="#8A9AB0">Name</text><line x1="104" y1="98" x2="258" y2="98" stroke="#C9D3DE" stroke-width="1.5"/><text x="62" y="124" font-family="Open Sans,Arial,sans-serif" font-size="12" fill="#8A9AB0">Date</text><line x1="104" y1="126" x2="258" y2="126" stroke="#C9D3DE" stroke-width="1.5"/><text x="62" y="152" font-family="Open Sans,Arial,sans-serif" font-size="12" fill="#8A9AB0">Time</text><line x1="104" y1="154" x2="258" y2="154" stroke="#C9D3DE" stroke-width="1.5"/><path d="M110 94 c6 -14 10 -14 8 0 s8 -12 11 -2 s6 -10 10 -1 s9 -8 12 0 s7 -9 10 -1 s8 -10 12 -2 s9 -6 14 -2" fill="none" stroke="#22405F" stroke-width="2.2" stroke-linecap="round"/><text x="110" y="122" font-family="Segoe Print,Bradley Hand,Comic Sans MS,cursive" font-size="15" fill="#22405F">9/10/26</text><text x="110" y="150" font-family="Segoe Print,Bradley Hand,Comic Sans MS,cursive" font-size="15" fill="#22405F">11:30</text><g transform="translate(196 120) rotate(-38)">
  <path d="M0 0 L10 -5 L10 5Z" fill="#22405F"/>
  <rect x="10" y="-6" width="16" height="12" fill="#C9D3DE"/>
  <rect x="26" y="-7" width="92" height="14" rx="4" fill="#2F6DB3"/>
  <rect x="96" y="-7" width="22" height="14" rx="4" fill="#1E3A5F"/>
  <rect x="70" y="-10" width="40" height="4" rx="2" fill="#1E3A5F"/>
</g></svg>`,
"img/sample-2.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img"><rect width="320" height="220" rx="16" fill="#EEF4FA"/><path d="M40 40 h96 a14 14 0 0 1 14 14 v18" fill="none" stroke="#1E3A5F" stroke-width="16" stroke-linecap="round"/><rect x="138" y="66" width="24" height="12" rx="4" fill="#1E3A5F"/><rect x="82" y="22" width="12" height="18" fill="#1E3A5F"/><rect x="66" y="16" width="44" height="10" rx="5" fill="#2F6DB3"/><path d="M150 85.5 C151.75 89.5 155 93.0 155 96 A5 5 0 1 1 145 96 C145 93.0 148.25 89.5 150 85.5Z" fill="#5AA0E0"/><ellipse cx="148.25" cy="95.0" rx="1.1" ry="1.75" fill="#fff" opacity=".45"/><path d="M143 107.6 C144.4 110.8 147 113.6 147 116 A4 4 0 1 1 139 116 C139 113.6 141.6 110.8 143 107.6Z" fill="#5AA0E0"/><ellipse cx="141.6" cy="115.2" rx="0.88" ry="1.4" fill="#fff" opacity=".45"/><path d="M156 112.55 C157.575 116.15 160.5 119.3 160.5 122 A4.5 4.5 0 1 1 151.5 122 C151.5 119.3 154.425 116.15 156 112.55Z" fill="#5AA0E0"/><ellipse cx="154.425" cy="121.1" rx="0.99" ry="1.575" fill="#fff" opacity=".45"/><path d="M149 131.6 C150.4 134.8 153 137.6 153 140 A4 4 0 1 1 145 140 C145 137.6 147.6 134.8 149 131.6Z" fill="#5AA0E0"/><ellipse cx="147.6" cy="139.2" rx="0.88" ry="1.4" fill="#fff" opacity=".45"/><g transform="translate(150 196) scale(1 1)">
  <path d="M0 -38 C-18 -38 -36 -40 -52 -52 C-60 -58 -70 -56 -70 -46 C-70 -36 -60 -30 -50 -24 L-46 4 L-4 4 Z" fill="#F2C7A5" stroke="#C98E68" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-12 -30 C-24 -34 -34 -36 -44 -40" fill="none" stroke="#C98E68" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>
  <rect x="-50" y="4" width="46" height="20" fill="#1E3A5F"/>
</g><g transform="translate(150 196) scale(-1 1)">
  <path d="M0 -38 C-18 -38 -36 -40 -52 -52 C-60 -58 -70 -56 -70 -46 C-70 -36 -60 -30 -50 -24 L-46 4 L-4 4 Z" fill="#F2C7A5" stroke="#C98E68" stroke-width="2" stroke-linejoin="round"/>
  <path d="M-12 -30 C-24 -34 -34 -36 -44 -40" fill="none" stroke="#C98E68" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>
  <rect x="-50" y="4" width="46" height="20" fill="#1E3A5F"/>
</g><path d="M150 158 v42" stroke="#C98E68" stroke-width="2"/><g transform="translate(222 70)"><rect x="0" y="0" width="64" height="88" rx="8" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><rect x="0" y="62" width="64" height="10" fill="#DCE8F5"/><rect x="0" y="76" width="64" height="4" fill="#DCE8F5"/><rect x="-6" y="-8" width="76" height="12" rx="6" fill="#1E3A5F"/></g><circle cx="276" cy="64" r="12" fill="#1F7A55"/><path d="M270.6 64 l3.84 4.08 l7.199999999999999 -7.92" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
"img/sample-3.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img"><rect width="320" height="220" rx="16" fill="#EEF4FA"/><g transform="translate(44 84) rotate(0) scale(1.0)" stroke-linejoin="round">
  <rect x="-40" y="-2" width="44" height="70" rx="6" fill="#1E3A5F"/>
  <rect x="-6" y="-2" width="10" height="70" fill="#2B4A6F"/>
  <path d="M0 4 Q0 -2 8 -2 L60 -2 Q74 -2 74 12 L74 56 Q74 68 60 68 L8 68 Q0 68 0 62Z" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="58" y="24" width="34" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="38" width="31" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="52" y="52" width="27" height="14" rx="7" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="2" width="98" height="23" rx="11.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="133" y="6" width="16" height="15" rx="6" fill="#F9E1D0" stroke="#C98E68" stroke-width="1.4"/>
  <path d="M100 8 v11 M110 8 v11" stroke="#C98E68" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>
  <g transform="translate(118 -4) rotate(-12)"><rect x="0" y="0" width="34" height="36" rx="3" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><path d="M5 10 h24 M5 18 h24 M5 26 h24" stroke="#DCE8F5" stroke-width="2"/></g>
</g><g transform="translate(70 22) rotate(-6)"><path d="M0 0 h70 l-4 4 l4 4 l-4 4 l4 4 l-4 4 l4 4 l-4 4 l4 4 l-4 4 l4 4 h-70z" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><rect x="8" y="10" width="30" height="20" rx="3" fill="#2F6DB3"/><text x="23" y="24" text-anchor="middle" font-family="Lexend,Arial,sans-serif" font-size="9" font-weight="700" fill="#fff">70%</text><path d="M44 14 h14 M44 22 h10" stroke="#8A9AB0" stroke-width="2"/></g><path d="M168 72 q10 6 0 12 M178 68 q12 10 0 20" fill="none" stroke="#2F6DB3" stroke-width="2.4" stroke-linecap="round"/><g><circle cx="262" cy="120" r="24" fill="#fff" stroke="#1E3A5F" stroke-width="3"/><path d="M262 107 V120 L271 126" fill="none" stroke="#1E3A5F" stroke-width="3" stroke-linecap="round"/><rect x="236" y="148" width="52" height="22" rx="11" fill="#1E3A5F"/><text x="262" y="163.5" text-anchor="middle" font-family="Lexend,Arial,sans-serif" font-size="13" font-weight="600" fill="#fff">1 min</text></g></svg>`,
"img/sample-4.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img"><rect width="320" height="220" rx="16" fill="#EEF4FA"/><g transform="translate(30 104) rotate(0) scale(1.05)" stroke-linejoin="round">
  <rect x="-40" y="-2" width="44" height="70" rx="6" fill="#1E3A5F"/>
  <rect x="-6" y="-2" width="10" height="70" fill="#2B4A6F"/>
  <path d="M0 4 Q0 -2 8 -2 L60 -2 Q74 -2 74 12 L74 56 Q74 68 60 68 L8 68 Q0 68 0 62Z" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="58" y="24" width="34" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="38" width="31" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="52" y="52" width="27" height="14" rx="7" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="2" width="98" height="23" rx="11.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="133" y="6" width="16" height="15" rx="6" fill="#F9E1D0" stroke="#C98E68" stroke-width="1.4"/>
  <path d="M100 8 v11 M110 8 v11" stroke="#C98E68" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>
  <g transform="translate(140 -2) rotate(-58)"><rect x="0" y="-9" width="22" height="18" rx="5" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><rect x="20" y="-12" width="62" height="24" rx="10" fill="#2F6DB3"/><rect x="30" y="-12" width="6" height="24" fill="#1E3A5F" opacity=".35"/><rect x="42" y="-12" width="6" height="24" fill="#1E3A5F" opacity=".35"/><rect x="78" y="-8" width="10" height="16" rx="4" fill="#1E3A5F"/></g>
</g><line x1="159.0" y1="89.0" x2="150.3" y2="84.0" stroke="#C8102E" stroke-width="3" stroke-linecap="round"/><line x1="170.5" y1="79.3" x2="167.1" y2="69.9" stroke="#C8102E" stroke-width="3" stroke-linecap="round"/><line x1="185.6" y1="79.3" x2="189.0" y2="69.9" stroke="#C8102E" stroke-width="3" stroke-linecap="round"/><path d="M187.5 124.35 C189.775 129.55 194.0 134.1 194.0 138 A6.5 6.5 0 1 1 181.0 138 C181.0 134.1 185.225 129.55 187.5 124.35Z" fill="#C8102E"/><ellipse cx="185.225" cy="136.7" rx="1.43" ry="2.275" fill="#fff" opacity=".45"/><g transform="translate(232 150) rotate(8)"><rect x="0" y="0" width="56" height="44" rx="4" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><path d="M6 10 h44 M6 22 h44 M6 34 h44" stroke="#DCE8F5" stroke-width="2"/><circle cx="30" cy="22" r="6" fill="#C8102E" opacity=".75"/></g></svg>`,
"img/sample-5.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img"><rect width="320" height="220" rx="16" fill="#EEF4FA"/><rect x="57" y="123" width="210" height="92" rx="8" fill="#000" opacity=".08"/><rect x="54" y="118" width="210" height="92" rx="8" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><path d="M62 118 h38 v92 h-38 a8 8 0 0 1 -8 -8 v-76 a8 8 0 0 1 8 -8z" fill="#2F6DB3"/><text x="81" y="169.0" text-anchor="middle" font-family="Lexend,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff" transform="rotate(-90 81 164.0)">DNA</text><circle cx="120.0" cy="168.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="120.0" cy="168.0" r="14.5" fill="#C8102E"/><circle cx="120.0" cy="168.0" r="14.5" fill="none" stroke="#8E0B20" stroke-width="1" opacity=".5"/><circle cx="160.0" cy="168.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="160.0" cy="168.0" r="14.5" fill="#C8102E"/><circle cx="160.0" cy="168.0" r="14.5" fill="none" stroke="#8E0B20" stroke-width="1" opacity=".5"/><circle cx="200.0" cy="168.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="240.0" cy="168.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><rect x="102.0" y="128" width="70" height="5" rx="2.5" fill="#DCE8F5"/><g transform="translate(208.06 7.760000000000005) rotate(90) scale(0.62)" stroke-linejoin="round">
  <rect x="-40" y="-2" width="44" height="70" rx="6" fill="#1E3A5F"/>
  <rect x="-6" y="-2" width="10" height="70" fill="#2B4A6F"/>
  <path d="M0 4 Q0 -2 8 -2 L60 -2 Q74 -2 74 12 L74 56 Q74 68 60 68 L8 68 Q0 68 0 62Z" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="58" y="24" width="34" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="38" width="31" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="52" y="52" width="27" height="14" rx="7" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="2" width="98" height="23" rx="11.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="133" y="6" width="16" height="15" rx="6" fill="#F9E1D0" stroke="#C98E68" stroke-width="1.4"/>
  <path d="M100 8 v11 M110 8 v11" stroke="#C98E68" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>
  
</g><path d="M200.0 119.4 C202.1 124.2 206.0 128.4 206.0 132.0 A6 6 0 1 1 194.0 132.0 C194.0 128.4 197.9 124.2 200.0 119.4Z" fill="#C8102E"/><ellipse cx="197.9" cy="130.8" rx="1.32" ry="2.0999999999999996" fill="#fff" opacity=".45"/><g transform="translate(270.0 94.0)"><circle r="15" fill="#fff" stroke="#C8102E" stroke-width="3"/><path d="M-6 -2 v-6 a2.5 2.5 0 0 1 5 0 v4 M-1 -6 a2.5 2.5 0 0 1 5 0 v5 M4 -3 a2.5 2.5 0 0 1 5 0 v4 c0 6 -3 10 -8 10 h-2 c-4 0 -6 -3 -8 -6 l-3 -5 a2 2 0 0 1 4 -2 l2 3" fill="none" stroke="#22405F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="scale(.9)"/><line x1="-10.6" y1="-10.6" x2="10.6" y2="10.6" stroke="#C8102E" stroke-width="3"/></g></svg>`,
"img/sample-6.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img"><rect width="320" height="220" rx="16" fill="#EEF4FA"/><g transform="translate(30 26) rotate(0) scale(0.8)" stroke-linejoin="round">
  <rect x="-40" y="-2" width="44" height="70" rx="6" fill="#1E3A5F"/>
  <rect x="-6" y="-2" width="10" height="70" fill="#2B4A6F"/>
  <path d="M0 4 Q0 -2 8 -2 L60 -2 Q74 -2 74 12 L74 56 Q74 68 60 68 L8 68 Q0 68 0 62Z" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="58" y="24" width="34" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="38" width="31" height="15" rx="7.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="52" y="52" width="27" height="14" rx="7" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="56" y="2" width="98" height="23" rx="11.5" fill="#F2C7A5" stroke="#C98E68" stroke-width="2"/>
  <rect x="133" y="6" width="16" height="15" rx="6" fill="#F9E1D0" stroke="#C98E68" stroke-width="1.4"/>
  <path d="M100 8 v11 M110 8 v11" stroke="#C98E68" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>
  <rect x="114" y="0" width="30" height="27" rx="5" fill="#E9B98F" stroke="#C98E68" stroke-width="1.6"/><rect x="122" y="5" width="14" height="17" rx="2" fill="#F6DCC2"/><circle cx="118" cy="7" r="1" fill="#C98E68"/><circle cx="118" cy="20" r="1" fill="#C98E68"/><circle cx="140" cy="7" r="1" fill="#C98E68"/><circle cx="140" cy="20" r="1" fill="#C98E68"/>
</g><rect x="25" y="117" width="214" height="84" rx="8" fill="#000" opacity=".08"/><rect x="22" y="112" width="214" height="84" rx="8" fill="#fff" stroke="#C9D3DE" stroke-width="2"/><path d="M30 112 h38 v84 h-38 a8 8 0 0 1 -8 -8 v-68 a8 8 0 0 1 8 -8z" fill="#2F6DB3"/><text x="49" y="159.0" text-anchor="middle" font-family="Lexend,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff" transform="rotate(-90 49 154.0)">DNA</text><circle cx="88.5" cy="158.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="88.5" cy="158.0" r="14.5" fill="#C8102E"/><circle cx="88.5" cy="158.0" r="14.5" fill="none" stroke="#8E0B20" stroke-width="1" opacity=".5"/><circle cx="129.5" cy="158.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="129.5" cy="158.0" r="14.5" fill="#C8102E"/><circle cx="129.5" cy="158.0" r="14.5" fill="none" stroke="#8E0B20" stroke-width="1" opacity=".5"/><circle cx="170.5" cy="158.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="170.5" cy="158.0" r="14.5" fill="#C8102E"/><circle cx="170.5" cy="158.0" r="14.5" fill="none" stroke="#8E0B20" stroke-width="1" opacity=".5"/><circle cx="211.5" cy="158.0" r="17" fill="#fff" stroke="#8A9AB0" stroke-width="1.6" stroke-dasharray="3 3"/><circle cx="211.5" cy="158.0" r="14.5" fill="#C8102E"/><circle cx="211.5" cy="158.0" r="14.5" fill="none" stroke="#8E0B20" stroke-width="1" opacity=".5"/><rect x="70.5" y="122" width="70" height="5" rx="2.5" fill="#DCE8F5"/><g><circle cx="276" cy="96" r="24" fill="#fff" stroke="#1E3A5F" stroke-width="3"/><path d="M276 83 V96 L285 102" fill="none" stroke="#1E3A5F" stroke-width="3" stroke-linecap="round"/><rect x="250" y="124" width="52" height="22" rx="11" fill="#1E3A5F"/><text x="276" y="139.5" text-anchor="middle" font-family="Lexend,Arial,sans-serif" font-size="13" font-weight="600" fill="#fff">4 h</text></g><circle cx="230" cy="114" r="13" fill="#1F7A55"/><path d="M224.15 114 l4.16 4.42 l7.8 -8.58" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
"login.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Staff login</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{--navy:#1E3A5F;--ink:#22405F;--muted:#5B6F86;--red:#E0482B;--band:#ECEEF2;--bg:#F4F5F8;--line:#2B4A6F}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:"Open Sans",system-ui,sans-serif}
  .paper{max-width:520px;margin:48px auto;background:#fff;padding:36px 36px 30px;box-shadow:0 1px 3px rgba(30,58,95,.08),0 12px 40px rgba(30,58,95,.08)}
  @media (max-width:560px){.paper{margin:0;min-height:100vh;padding:28px 16px;box-shadow:none}}
  .title{border-left:2px solid var(--navy);padding-left:16px;font-family:Lexend;color:var(--navy);line-height:1.15;margin-bottom:26px}
  .title .l1{font-weight:300;font-size:22px}.title .l2{font-weight:600;font-size:28px}
  p{line-height:1.55;margin:0 0 18px}
  label{display:block;font-weight:700;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:var(--navy);margin-bottom:8px}
  input{width:100%;font:inherit;font-size:18px;padding:13px 14px;border:2px solid #C9D3DE;border-radius:10px;color:var(--navy);outline:none}
  input:focus{border-color:var(--navy);box-shadow:0 0 0 4px rgba(30,58,95,.08)}
  input.code{font-family:Lexend;font-size:28px;letter-spacing:.3em;text-align:center}
  .btn{margin-top:18px;width:100%;font-family:Lexend;font-weight:500;font-size:16px;border-radius:999px;padding:14px 26px;border:1.5px solid var(--navy);background:var(--navy);color:#fff;cursor:pointer}
  .btn[disabled]{opacity:.5;cursor:wait}
  .link{background:none;border:0;padding:0;margin-top:14px;color:var(--navy);text-decoration:underline;font:inherit;font-size:14px;cursor:pointer}
  .err{color:var(--red);font-size:14px;min-height:20px;margin-top:10px}
  .hidden{display:none!important}
  .note{font-size:13px;color:var(--muted);margin-top:22px}
</style>
</head>
<body>
<div class="paper">
  <div class="title"><div class="l1">Nordic Health</div><div class="l2">Staff login</div></div>

  <form id="f1" novalidate>
    <p>Enter your work email. If it's on the Staff list, we'll email you a 6-digit code.</p>
    <label for="email">Work email</label>
    <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="name@company.com" maxlength="120" required autofocus>
    <button class="btn" type="submit" id="send">Email me a code</button>
    <div class="err" id="e1" role="alert"></div>
  </form>

  <form id="f2" class="hidden" novalidate>
    <p id="sentMsg"></p>
    <label for="code">Code from the email</label>
    <input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required>
    <button class="btn" type="submit" id="check">Log in</button>
    <div class="err" id="e2" role="alert"></div>
    <button type="button" class="link" id="back">Use a different email, or send a new code</button>
  </form>

  <p class="note">Staff login lasts for the day on this device. Use a private device or log out when you're done.</p>
</div>
<script>
const $ = s => document.querySelector(s);
const next = (() => {
  const n = new URLSearchParams(location.search).get("next") || "/staff";
  return /^\\/(staff|lab)(\\/|\\?|$)/.test(n) ? n : "/staff";
})();
async function post(url, body){
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"same-origin", body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ ok:false, error:"The server didn't answer properly. Please try again." }));
  if (!d.ok) throw new Error(d.error || "Something went wrong.");
  return d.result;
}
function busy(btn, on, label){ btn.disabled = on; btn.textContent = on ? "Please wait…" : label; }
$("#f1").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#email").value.trim();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email)) { $("#e1").textContent = "Enter your work email address."; return; }
  $("#e1").textContent = ""; busy($("#send"), true, "Email me a code");
  try {
    const r = await post("/auth/send-code", { email });
    $("#sentMsg").textContent = \`If \${r.to} is on the Staff list, a code is on its way. It works for 10 minutes. Check your spam folder if it doesn't arrive.\`;
    $("#f1").classList.add("hidden"); $("#f2").classList.remove("hidden"); $("#code").value = ""; $("#code").focus();
  } catch (err) { $("#e1").textContent = err.message; }
  finally { busy($("#send"), false, "Email me a code"); }
});
$("#f2").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#code").value.replace(/\\D/g, "");
  if (code.length !== 6) { $("#e2").textContent = "The code has 6 digits."; return; }
  $("#e2").textContent = ""; busy($("#check"), true, "Log in");
  try { await post("/auth/check-code", { email: $("#email").value.trim(), code }); location.replace(next); }
  catch (err) { $("#e2").textContent = err.message; busy($("#check"), false, "Log in"); }
});
$("#code").addEventListener("input", () => { if ($("#code").value.replace(/\\D/g, "").length === 6) $("#f2").requestSubmit(); });
$("#back").addEventListener("click", () => { $("#f2").classList.add("hidden"); $("#f1").classList.remove("hidden"); $("#e2").textContent = ""; $("#email").focus(); });
</script>
</body>
</html>
`,
"scanner.js": `/* Camera barcode scanner, built into the page (no pop-up window).
   Works now that the page runs on its own website: inside Apps Script, Google's frame blocked the camera.

   NHScanner.supported()          true when this browser can use a camera here
   NHScanner.open({ onResult })   opens the scanner; onResult(text) gets the barcode once it has been read twice the same way

   Uses the browser's own barcode reader where it exists (Chrome on Android and Mac, Edge), and otherwise
   loads the ZXing library (Chrome on Windows, Safari on iPhone/iPad, Firefox). */
(function () {
  "use strict";
  var FORMATS = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "qr_code", "data_matrix", "pdf417"];
  var ZXING_SOURCES = ["/vendor/zxing.min.js", "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"];
  var zxingLoading = null;

  function supported() {
    return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { window.ZXing ? res(window.ZXing) : rej(new Error("ZXing missing")); };
      s.onerror = function () { s.remove(); rej(new Error("load failed")); };
      document.head.appendChild(s);
    });
  }
  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (!zxingLoading) {
      zxingLoading = ZXING_SOURCES.reduce(function (p, src) {
        return p.catch(function () { return loadScript(src); });
      }, Promise.reject()).catch(function (e) { zxingLoading = null; throw e; });
    }
    return zxingLoading;
  }

  async function nativeDetector() {
    if (!("BarcodeDetector" in window)) return null;
    try {
      var have = await window.BarcodeDetector.getSupportedFormats();
      var use = FORMATS.filter(function (f) { return have.indexOf(f) >= 0; });
      if (!use.length) return null;
      var d = new window.BarcodeDetector({ formats: use });
      return { detect: async function (video) { var r = await d.detect(video); return r && r[0] ? r[0].rawValue : ""; } };
    } catch (e) { return null; }
  }

  async function zxingDetector() {
    var Z = await loadZxing();
    var hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    var reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    return {
      detect: async function (video) {
        var w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return "";
        // Read the middle band of the picture (where the guide box is), scaled down: faster and more reliable.
        var cw = Math.min(1280, w), ch = Math.round(h * 0.5 * (cw / w));
        canvas.width = cw; canvas.height = ch;
        ctx.drawImage(video, 0, h * 0.25, w, h * 0.5, 0, 0, cw, ch);
        try {
          var lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
          var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(lum));
          return reader.decode(bmp).getText();
        } catch (e) { return ""; }
      }
    };
  }

  function cameraError(err) {
    var n = err && err.name;
    if (n === "NotAllowedError" || n === "SecurityError")
      return "The camera is blocked for this page. In Chrome, tap the icon at the left of the address bar, set Camera to Allow, then press Scan with camera again. You can also type the number.";
    if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera was found on this device. Type the number instead.";
    if (n === "NotReadableError" || n === "AbortError") return "The camera is being used by another app. Close it and try again, or type the number.";
    return "The camera couldn't start (" + ((err && err.message) || n || "unknown error") + "). Type the number instead.";
  }

  var CSS = ".nhs{position:fixed;inset:0;z-index:1000;background:#0B1726;display:flex;flex-direction:column;color:#fff;font-family:Lexend,system-ui,sans-serif}" +
    ".nhs video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}" +
    ".nhs .shade{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center}" +
    ".nhs .box{width:min(86vw,560px);height:min(34vw,210px);min-height:130px;border-radius:14px;box-shadow:0 0 0 200vmax rgba(11,23,38,.55);border:3px solid #fff;position:relative}" +
    ".nhs .box::after{content:'';position:absolute;left:6%;right:6%;top:50%;height:2px;background:#E0482B;box-shadow:0 0 12px #E0482B;animation:nhsl 1.6s ease-in-out infinite alternate}" +
    "@keyframes nhsl{from{transform:translateY(-40px)}to{transform:translateY(40px)}}" +
    "@media (prefers-reduced-motion:reduce){.nhs .box::after{animation:none}}" +
    ".nhs .top,.nhs .bottom{position:relative;padding:18px 16px;text-align:center;background:linear-gradient(rgba(11,23,38,.85),rgba(11,23,38,0))}" +
    ".nhs .bottom{margin-top:auto;background:linear-gradient(rgba(11,23,38,0),rgba(11,23,38,.9));padding-bottom:max(22px,env(safe-area-inset-bottom))}" +
    ".nhs h2{margin:0 0 4px;font-weight:500;font-size:20px;color:#fff;font-family:Lexend,system-ui,sans-serif}.nhs p{margin:0;font-size:15px;opacity:.9;line-height:1.45}" +
    ".nhs .msg{min-height:22px;margin:0 auto 14px;max-width:560px;font-size:15px}.nhs .msg.bad{color:#FFB4A6}" +
    ".nhs button{font:inherit;font-weight:500;font-size:16px;border-radius:999px;padding:13px 28px;border:1.5px solid #fff;background:transparent;color:#fff;cursor:pointer;margin:0 6px}" +
    ".nhs button.light{background:#fff;color:#1E3A5F}.nhs .ok{color:#9BE3B8}";

  var current = null;

  async function open(opts) {
    opts = opts || {};
    if (current) return;
    if (!document.getElementById("nhsCss")) { var st = document.createElement("style"); st.id = "nhsCss"; st.textContent = CSS; document.head.appendChild(st); }
    var el = document.createElement("div");
    el.className = "nhs"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Scan barcode with camera");
    el.innerHTML = '<video playsinline muted autoplay></video><div class="shade"><div class="box"></div></div>' +
      '<div class="top"><h2>' + (opts.title || "Scan the barcode") + '</h2><p>Hold the barcode inside the box. Keep it still for a moment.</p></div>' +
      '<div class="bottom"><p class="msg" aria-live="polite">Starting the camera…</p><button type="button" class="torch" hidden>Light on</button><button type="button" class="light close">Cancel</button></div>';
    document.body.appendChild(el);
    var video = el.querySelector("video"), msg = el.querySelector(".msg"), torchBtn = el.querySelector(".torch");
    var stream = null, stopped = false, last = "", lastAt = 0;
    var prevFocus = document.activeElement;

    function close(result) {
      if (stopped) return;
      stopped = true; current = null;
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      el.remove();
      document.removeEventListener("keydown", onKey);
      try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) {}
      if (result && opts.onResult) opts.onResult(result);
      else if (!result && opts.onCancel) opts.onCancel();
    }
    function onKey(e) { if (e.key === "Escape") close(null); }
    document.addEventListener("keydown", onKey);
    el.querySelector(".close").addEventListener("click", function () { close(null); });
    el.querySelector(".close").focus();
    current = { close: close };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
    } catch (err) {
      if (stopped) return;
      msg.className = "msg bad"; msg.textContent = cameraError(err);
      if (opts.onError) opts.onError(cameraError(err));
      return;
    }
    if (stopped) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}

    // Phone torch, where the browser supports it (Chrome on Android).
    var track = stream.getVideoTracks()[0];
    try {
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        torchBtn.hidden = false;
        var on = false;
        torchBtn.addEventListener("click", function () {
          on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(function () {});
          torchBtn.textContent = on ? "Light off" : "Light on";
        });
      }
      if (caps.focusMode && caps.focusMode.indexOf("continuous") >= 0) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () {});
    } catch (e) {}

    var detector = await nativeDetector();
    if (!detector) {
      try { detector = await zxingDetector(); }
      catch (e) { msg.className = "msg bad"; msg.textContent = "The barcode reader couldn't load. Check the internet connection, or type the number."; return; }
    }
    msg.className = "msg"; msg.textContent = "Looking for a barcode…";

    (async function loop() {
      while (!stopped) {
        var text = "";
        try { if (video.readyState >= 2) text = await detector.detect(video); } catch (e) {}
        text = String(text || "").replace(/[\\u0000-\\u001F\\u007F]/g, "").trim();
        if (text) {
          var now = Date.now();
          // Same result twice in a row: protects against a misread from a blurry frame.
          if (text === last && now - lastAt < 2500) {
            msg.className = "msg ok"; msg.textContent = "Got it: " + text;
            if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
            setTimeout(function () { close(text.slice(0, 64)); }, 350);
            return;
          }
          last = text; lastAt = now;
        }
        await new Promise(function (r) { setTimeout(r, 120); });
      }
    })();
  }

  window.NHScanner = { supported: supported, open: open, close: function () { if (current) current.close(null); } };
})();
`
};
const EMBEDDED_PATCHES = { "index.html": { regexes: [["      <figure class=\"howto\" id=\"howto\"[\\s\\S]*?</figure>\\n",""],["// The number coming back from scan\\.html\\.[\\s\\S]*?\\n\\}\\);\\n",""]], pairs: [
[`<script type="application/json" id="boot"><?!= bootJson ?></script>
`,
`<script type="application/json" id="boot"><?!= bootJson ?></script>
<script src="/gas-shim.js"></script>
<script src="/scanner.js"></script>
`],
[`<!-- If the page's code fails to start (for example Index was only partly pasted into Apps Script),`,
`<!-- If the page's code fails to start,`],
[`". Check that the whole Index file was pasted into Apps Script (it ends with &lt;/html&gt;) and that a new version was deployed.</small>"`,
`". Reload the page; if it keeps happening, check the latest deploy on Railway.</small>"`],
[`until this page runs from Google Apps Script.</div>`,
`until this page runs on the order website.</div>`],
[`      <p class="note" id="bcLockNote" style="margin:8px 0 0">You can start a new order once the barcode is saved.</p>
    </div>`,
`      <p class="note" id="bcLockNote" style="margin:8px 0 0">You can start a new order once the barcode is saved.</p>
      <div class="guide" id="guide">
        <h3>Giving your blood sample</h3>
        <p>The Nordic representative at the stand will help you with each step. Tap a picture to see it larger.</p>
        <ol class="gsteps">
          <li><button type="button" class="gpic" aria-label="Show step 1 larger"><img src="/img/sample-1.svg" alt="The back of the test card with name, date and time written on it" width="320" height="220"></button>
            <div><b>Write on the back of the card</b><span>Your full name, and the date and time you take the sample.</span></div></li>
          <li><button type="button" class="gpic" aria-label="Show step 2 larger"><img src="/img/sample-2.svg" alt="Hands being washed under a tap, with a clean towel" width="320" height="220"></button>
            <div><b>Wash and dry your hands</b><span>Use warm water and a clean towel. Warm hands make the blood flow more easily.</span></div></li>
          <li><button type="button" class="gpic" aria-label="Show step 3 larger"><img src="/img/sample-3.svg" alt="A fingertip being cleaned with an alcohol wipe, then left to dry for one minute" width="320" height="220"></button>
            <div><b>Clean your finger and let it dry</b><span>Use the middle or ring finger of the hand you don't write with. Wipe it with the alcohol wipe, then let it dry for 1 minute.</span></div></li>
          <li><button type="button" class="gpic" aria-label="Show step 4 larger"><img src="/img/sample-4.svg" alt="The lancet pressed firmly against the side of the fingertip, and the first drop wiped away" width="320" height="220"></button>
            <div><b>Prick the side of your fingertip</b><span>Press the lancet's white end firmly against the fingertip until it clicks. Wipe away the first drop with the sterile pad.</span></div></li>
          <li><button type="button" class="gpic" aria-label="Show step 5 larger"><img src="/img/sample-5.svg" alt="A drop of blood falling from the finger into the middle of a circle on the test card, without the finger touching the card" width="320" height="220"></button>
            <div><b>Fill every circle with a drop</b><span>Hold your finger over the card and let a drop fall into the middle of each circle. Don't touch the card. Gently massage your finger (don't squeeze) for the next drop.</span></div></li>
          <li><button type="button" class="gpic" aria-label="Show step 6 larger"><img src="/img/sample-6.svg" alt="A plaster on the fingertip, and a test card with all four circles filled, left to dry for 4 hours" width="320" height="220"></button>
            <div><b>Plaster on, card back to us</b><span>Clean your finger and put on the plaster. Hand the card back to the representative: it has to dry for at least 4 hours before it goes in its sealed bag.</span></div></li>
        </ol>
      </div>
    </div>`],
[`  .howto{margin:4px 0 16px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff;cursor:zoom-in;position:relative}
  .howto img{display:block;width:100%;height:auto}
  .howto .zoomhint{position:absolute;right:8px;bottom:8px;background:rgba(30,58,95,.85);color:#fff;font-size:calc(12px * var(--fs));border-radius:999px;padding:4px 10px}
`,
`  .guide{margin:22px 0 0;padding-top:18px;border-top:1.5px solid var(--band)}
  .gsteps{list-style:none;counter-reset:g;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:18px 16px}
  @media (max-width:560px){.gsteps{grid-template-columns:1fr}}
  .gsteps li{counter-increment:g;display:flex;flex-direction:column;gap:8px}
  .gpic{display:block;padding:0;border:0;background:none;border-radius:12px;cursor:zoom-in;position:relative}
  .gpic img{display:block;width:100%;height:auto;border-radius:12px}
  .gpic::before{content:counter(g);position:absolute;left:8px;top:8px;width:30px;height:30px;border-radius:50%;background:var(--navy);color:#fff;font-family:Lexend;font-weight:600;font-size:15px;display:grid;place-items:center}
  .gsteps b{display:block;font-family:Lexend;font-weight:500;color:var(--navy);font-size:calc(16px * var(--fs));margin-bottom:2px}
  .gsteps span{font-size:calc(14px * var(--fs));line-height:1.5;color:var(--ink)}
`],
[`  .howbig img{max-width:100%;max-height:100%;border-radius:8px;background:#fff}`,
`  .howbig img{width:min(100%,900px);max-height:100%;border-radius:12px;background:#fff}`],
[`/* ---------- After payment: link the barcode to the order ----------
   A handheld scanner "types" the number and presses Enter, so it just works in the box.
   The camera can't be used inside Apps Script (Google's frame blocks it), so "Scan with camera"
   opens scan.html, hosted elsewhere (Settings ▸ SCAN_PAGE_URL), which sends back only the number. */
const SCAN_URL = /^https:[\\/]{2}/.test(CFG.scanUrl || "") ? CFG.scanUrl : "";`,
`/* ---------- After payment: link the barcode to the order ----------
   A handheld scanner "types" the number and presses Enter, so it just works in the box.
   "Scan with camera" opens the camera right here on the page (scanner.js). This works because the
   page now runs on its own website: inside Apps Script, Google's frame blocked the camera in Chrome. */
const CAN_SCAN = !!(window.NHScanner && NHScanner.supported());`],
[`  $("#bcCam").classList.toggle("hidden", !SCAN_URL);
  $("#bcLabel").textContent = SCAN_URL ? "Or scan with a handheld scanner, or type the number" : "Scan with a handheld scanner, or type the number";`,
`  $("#bcCam").classList.toggle("hidden", !CAN_SCAN);
  $("#bcLabel").textContent = CAN_SCAN ? "Or scan with a handheld scanner, or type the number" : "Scan with a handheld scanner, or type the number";`],
[`// Instructions picture: tap to see it full screen, tap again (or Esc) to close.
function howtoBig(open){
  const old = document.querySelector(".howbig"); if (old) old.remove();
  if (!open) return;
  const d = document.createElement("div"); d.className = "howbig"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Test card instructions");
  d.innerHTML = \`<img alt="\${esc($("#howto img").alt)}" src="\${$("#howto img").getAttribute("src")}">\`;
  d.addEventListener("click", () => { howtoBig(false); $("#bcInput").focus(); });
  document.body.appendChild(d);
}
$("#howto").addEventListener("click", () => howtoBig(true));
$("#howto").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); howtoBig(true); } });
document.addEventListener("keydown", e => { if (e.key === "Escape") howtoBig(false); });`,
`// Sample pictures: tap one to see it full screen, tap again (or Esc) to close.
function howtoBig(img){
  const old = document.querySelector(".howbig"); if (old) old.remove();
  if (!img) return;
  const d = document.createElement("div"); d.className = "howbig"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", img.alt);
  d.innerHTML = \`<img alt="\${esc(img.alt)}" src="\${esc(img.getAttribute("src"))}">\`;
  d.addEventListener("click", () => howtoBig(null));
  document.body.appendChild(d);
}
$("#guide").addEventListener("click", e => { const b = e.target.closest(".gpic"); if (b) howtoBig(b.querySelector("img")); });
document.addEventListener("keydown", e => { if (e.key === "Escape") howtoBig(null); });`],
[`$("#bcCam").addEventListener("click", () => {
  const u = new URL(SCAN_URL); u.searchParams.set("ref", bc.ref); u.searchParams.set("title", CFG.title1 || "");
  const w = window.open(u.toString(), "nhscan", "popup,width=520,height=780");
  if (!w) $("#bcErr").textContent = "Your browser blocked the camera window. Allow pop-ups for this page, or type the number.";
});`,
`$("#bcCam").addEventListener("click", () => {
  if (!bc) return;
  $("#bcErr").textContent = "";
  NHScanner.open({
    title: "Scan the barcode on the test kit",
    onResult: text => { if (!bc || $("#bcStep").classList.contains("hidden")) return; $("#bcInput").value = text; submitBarcode(text); },
    onError: msg => { $("#bcErr").textContent = msg; }
  });
});`],
[`    $("#staffBar").innerHTML = \`<b>Staff mode</b><span>\${esc(BOOT.staff.email)}</span>\`;`,
`    $("#staffBar").innerHTML = \`<b>Staff mode</b><span>\${esc(BOOT.staff.email)} · <a href="/logout">Log out</a></span>\`;`],
[`<span>This Google account is not on the Staff list. Ask an admin to add you, or continue as a normal order.</span>\`;`,
`<span>This email is not on the Staff list (any more). Ask an admin to add you, <a href="/logout">log in again</a>, or continue as a normal order.</span>\`;`]
] },
"lab.html": { regexes: [], pairs: [
[`  .scanrow{display:flex;gap:10px;flex-wrap:wrap}
  .scanrow input{flex:1;min-width:220px;font:inherit;font-family:Lexend;font-size:calc(24px * var(--fs));letter-spacing:.06em;padding:14px 16px;border:2px solid #C9D3DE;border-radius:10px;color:var(--navy);outline:none;background:#fff}
`,
`  .scanrow{display:flex;gap:10px;flex-wrap:wrap}
  .btn.ghost{background:#fff;color:var(--navy)}
  .scanrow input{flex:1;min-width:220px;font:inherit;font-family:Lexend;font-size:calc(24px * var(--fs));letter-spacing:.06em;padding:14px 16px;border:2px solid #C9D3DE;border-radius:10px;color:var(--navy);outline:none;background:#fff}
`],
[`<script type="application/json" id="boot"><?!= bootJson ?></script>

`,
`<script type="application/json" id="boot"><?!= bootJson ?></script>
<script src="/gas-shim.js"></script>
<script src="/scanner.js"></script>

`],
[`    <div class="title"><div class="l1" id="seller">Nordic Health</div><div class="l2">Lab lookup</div></div>
    <div class="who"><b>STAFF · VIEW ONLY</b><br><span id="staffEmail"></span><br>
      <button type="button" class="textsize" id="textSize" aria-pressed="false">A+ Larger text</button></div>
`,
`    <div class="title"><div class="l1" id="seller">Nordic Health</div><div class="l2">Lab lookup</div></div>
    <div class="who"><b>STAFF · VIEW ONLY</b><br><span id="staffEmail"></span> · <a href="/logout">Log out</a><br>
      <button type="button" class="textsize" id="textSize" aria-pressed="false">A+ Larger text</button></div>
`],
[`  </header>
  <div class="demo hidden" id="demoFlag">Preview: try barcode 5901234123457, DNA-KIT-000123 or DNA-KIT-000777. Nothing is real until this runs from Apps Script.</div>

`,
`  </header>
  <div class="demo hidden" id="demoFlag">Preview: try barcode 5901234123457, DNA-KIT-000123 or DNA-KIT-000777. Nothing is real until this runs on the order website.</div>

`],
[`        <button class="btn" type="submit" id="go">Look up</button>
      </div>
`,
`        <button class="btn" type="submit" id="go">Look up</button>
        <button class="btn ghost hidden" type="button" id="cam">Scan with camera</button>
      </div>
`],
[`    This page shows customer details, so it only works for people on the Staff list.
    Open the lab link while signed in to your company Google account, or ask an admin to add you
    to the Staff tab (Active = TRUE).
`,
`    This page shows customer details, so it only works for people on the Staff list.
    <a href="/logout">Log in again</a> with your work email, or ask an admin to add you
    to the Staff tab (Active = TRUE).
`],
[`
/* ---------- Larger text ---------- */
`,
`
/* ---------- Camera (phones/tablets without a handheld scanner) ---------- */
if (window.NHScanner && NHScanner.supported()){
  $("#cam").classList.remove("hidden");
  $("#cam").addEventListener("click", () => NHScanner.open({
    title: "Scan the kit's barcode",
    onResult: text => { $("#code").value = text; run(text); },
    onError: msg => showMsg("bad", esc(msg))
  }));
}

/* ---------- Larger text ---------- */
`]
] } };

const PORT = Number(process.env.PORT) || 3000;
const GAS_URL = String(process.env.APPS_SCRIPT_URL || '').trim();
const GAS_SECRET = String(process.env.APPS_SCRIPT_SECRET || '').trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const STAFF_HOURS = Math.min(24 * 7, Math.max(1, Number(process.env.STAFF_SESSION_HOURS) || 12));
const PREVIEW = !GAS_URL;
const PUBLIC_DIR = '/app/public';

if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set: staff will be logged out whenever the site restarts.');
if (PREVIEW) console.warn('APPS_SCRIPT_URL is not set: running in PREVIEW mode with demo data. Nothing is saved.');
else if (GAS_SECRET.length < 24) console.warn('APPS_SCRIPT_SECRET is missing or too short (min 24 characters): calls to Apps Script will be refused.');

/* ---------- Which Apps Script functions the page may call ---------- */
const PUBLIC_FNS = new Set(['submitOrder', 'checkOrder', 'resumePayment', 'startPractitionerCheck',
  'checkPractitioner', 'verifyPractitionerCode', 'saveBarcode']);
const STAFF_FNS = new Set(['searchCustomers', 'getCustomer', 'lookupBarcode']);

/* ---------- Files in public/ (the Railway Function build embeds them instead) ---------- */
function readPublic(rel) {
  if (typeof EMBEDDED_FILES !== 'undefined') {
    const f = EMBEDDED_FILES[rel.split(path.sep).join('/')];
    return f === undefined ? null : Buffer.from(f, 'utf8');
  }
  try { return fs.readFileSync(path.join(PUBLIC_DIR, rel)); } catch (e) { return null; }
}

/* ---------- Templates ---------- */
const TPL = {};
function tpl(name) {
  if (!TPL[name] || process.env.NODE_ENV === 'development') TPL[name] = readPublic(name).toString('utf8');
  return TPL[name];
}
/**
 * The Railway Function build doesn't carry index.html / lab.html. It takes the page from Apps Script
 * (Index / Lab files, via Api.gs ▸ getPageSource) and applies the same changes as public/index.html
 * (EMBEDDED_PATCHES): new sample pictures, camera scanning, website staff login.
 */
const PAGE_CACHE = {};
async function pageSource(name) {
  if (readPublic(name)) return tpl(name);
  const hit = PAGE_CACHE[name];
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.html;
  let html = await callGas('getPageSource', name === 'lab.html' ? 'Lab' : 'Index', '');
  const patch = (typeof EMBEDDED_PATCHES !== 'undefined' && EMBEDDED_PATCHES[name]) || { pairs: [], regexes: [] };
  patch.regexes.forEach(([re, to]) => { html = html.replace(new RegExp(re), to); });
  let missed = 0;
  patch.pairs.forEach(([from, to]) => { if (html.includes(from)) html = html.replace(from, () => to); else missed++; });
  if (missed) console.warn(name + ': ' + missed + ' change(s) did not match the Apps Script file (was it edited?).');
  PAGE_CACHE[name] = { html, at: Date.now() };
  return html;
}
async function withBoot(name, boot) {
  // Escape "<" so nothing in the data can close the <script> tag.
  const json = boot ? JSON.stringify(boot).replace(/</g, '\\u003c') : '';
  return (await pageSource(name)).replace('<?!= bootJson ?>', () => json);
}

/* ---------- Apps Script ---------- */
// Read-only calls are safe to repeat. Google now and then answers a web app call with an HTML
// error page instead of our JSON (it's not our script failing), so these get a second try.
const SAFE_TO_RETRY = new Set(['getBoot', 'getLabBoot', 'getPageSource', 'checkOrder', 'lookupBarcode',
  'searchCustomers', 'getCustomer']);
async function callGasOnce(fn, arg, staff, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      // text/plain keeps Apps Script happy; it follows Google's redirect to the answer automatically.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: GAS_SECRET, fn, arg: arg === undefined ? null : arg, staff: staff || '' }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    text = await res.text();
  } catch (err) {
    const e = new Error(err.name === 'AbortError' ? 'The order system took too long to answer. Please try again.' : 'Could not reach the order system. Please try again.');
    e.retryable = true;
    throw e;
  } finally { clearTimeout(timer); }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    const title = (String(text).match(/<title[^>]*>([^<]*)</i) || [])[1] || '';
    console.error('Apps Script did not answer with JSON', fn, res.status, title ? 'title: ' + title.trim() : '', String(text).slice(0, 200));
    const err = new Error('The order system is busy right now. Please try again in a moment.');
    err.retryable = true;
    throw err;
  }
  if (!data.ok) {
    if (data.code === 'auth') console.error('Apps Script refused the secret: APPS_SCRIPT_SECRET and API_SECRET must match.');
    const e = new Error(data.error || 'Something went wrong.');
    e.expected = true;
    throw e;
  }
  return data.result;
}
async function callGas(fn, arg, staff) {
  if (!SAFE_TO_RETRY.has(fn)) return callGasOnce(fn, arg, staff, 45000);
  try { return await callGasOnce(fn, arg, staff, 25000); }
  catch (err) {
    if (!err.retryable) throw err;
    console.warn(fn + ': first try failed (' + err.message + '), trying again');
    await new Promise(r => setTimeout(r, 1500));
    return callGasOnce(fn, arg, staff, 25000);
  }
}
// Last good order-page data per event, used if Apps Script has a hiccup (prices and stock are
// checked again on the server when the order is placed, so slightly old data is safe to show).
const BOOT_CACHE = new Map();
async function getBootCached(params, staff) {
  // Links with a one-time key (practitioner "Verify it's me") must only reach Apps Script once.
  if (params.verify || params.k) return callGasOnce('getBoot', params, staff || '', 45000);
  const key = JSON.stringify([params, staff || '']);
  try {
    const boot = await callGas('getBoot', params, staff || '');
    BOOT_CACHE.set(key, { boot, at: Date.now() });
    if (BOOT_CACHE.size > 50) BOOT_CACHE.delete(BOOT_CACHE.keys().next().value);
    return boot;
  } catch (err) {
    const hit = BOOT_CACHE.get(key);
    if (hit && !err.expected && Date.now() - hit.at < 30 * 60000) {
      console.warn('getBoot failed (' + err.message + '): showing the page from ' + Math.round((Date.now() - hit.at) / 1000) + 's ago');
      return hit.boot;
    }
    throw err;
  }
}

/* ---------- Staff login cookie (signed, HttpOnly) ---------- */
const COOKIE = 'nh_staff';
function sign(v) { return crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url'); }
function makeStaffCookie(email) {
  const v = Buffer.from(JSON.stringify({ e: email, x: Date.now() + STAFF_HOURS * 3600e3 })).toString('base64url');
  return v + '.' + sign(v);
}
function readStaff(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return '';
  const [v, s] = m[1].split('.');
  if (!v || !s) return '';
  const a = Buffer.from(sign(v)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return '';
  try {
    const d = JSON.parse(Buffer.from(v, 'base64url').toString());
    return d.x > Date.now() && typeof d.e === 'string' ? d.e : '';
  } catch (e) { return ''; }
}
function cookieHeader(req, value, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

/* ---------- Simple rate limits (per IP, in memory) ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
  h.n++;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.reset) hits.delete(k); }, 60000).unref();
function ipOf(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }

/* ---------- Helpers ---------- */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // The page itself may use the camera (barcode scanning). Nothing else.
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
};
function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS, extra || {}));
  res.end(body);
}
function json(res, status, obj, extra) { send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra); }
function redirect(res, to, extra) { res.writeHead(302, Object.assign({ Location: to, 'Cache-Control': 'no-store' }, SECURITY_HEADERS, extra || {})); res.end(); }
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too much data.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Bad request.')); } });
    req.on('error', reject);
  });
}
function errorPage(msg) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orders</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;background:#F4F5F8;color:#22405F;margin:0;padding:24px 16px">
<div style="max-width:560px;margin:40px auto;background:#fff;padding:28px;border-radius:10px;box-shadow:0 8px 30px rgba(30,58,95,.08)">
<h1 style="font-size:22px;margin:0 0 8px;color:#1E3A5F">Sorry, the order page can't open right now</h1>
<p style="margin:0 0 12px">${String(msg).replace(/[<>&]/g, '')}</p>
<p style="margin:0"><a href="" style="color:#1E3A5F">Try again</a> · or ask a member of staff at the stand.</p></div></body></html>`;
}
/** Only keep the query parameters the boot code understands. */
function bootParams(url, extra) {
  const p = {};
  ['event', 'order', 'result', 'k', 'verify'].forEach(k => { const v = url.searchParams.get(k); if (v) p[k] = v.slice(0, 200); });
  return Object.assign(p, extra || {});
}

const STATIC_TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (!/^(img|vendor)[/\\]|^(gas-shim|scanner)\.js$/.test(rel)) return false;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  const data = readPublic(rel);
  if (!data) return false;
  res.writeHead(200, Object.assign({ 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': rel.startsWith('vendor') ? 'public, max-age=604800' : 'public, max-age=300' }, SECURITY_HEADERS));
  res.end(data);
  return true;
}

/* ---------- Routes ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  let p = url.pathname;

  if (p === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (req.method === 'GET' && serveStatic(req, res, p)) return;

  // Nice event links: /event/CPHW → /?event=CPHW
  const ev = p.match(/^\/event\/([A-Za-z0-9_-]{1,20})\/?$/);
  if (ev && req.method === 'GET') { url.searchParams.set('event', ev[1]); p = '/'; }
  const evStaff = p.match(/^\/staff\/event\/([A-Za-z0-9_-]{1,20})\/?$/);
  if (evStaff && req.method === 'GET') { url.searchParams.set('event', evStaff[1]); p = '/staff'; }

  /* Order page (public) */
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    if (PREVIEW) return send(res, 200, await withBoot('index.html', null));
    try {
      const boot = await getBootCached(bootParams(url), '');
      return send(res, 200, await withBoot('index.html', boot));
    } catch (err) { console.error('getBoot', err.message); return send(res, 503, errorPage(err.message)); }
  }

  /* Staff order page and lab page: need a staff login */
  if (req.method === 'GET' && (p === '/staff' || p === '/lab')) {
    const staff = readStaff(req);
    if (PREVIEW) return send(res, 200, await withBoot(p === '/lab' ? 'lab.html' : 'index.html', null));
    if (!staff) return redirect(res, '/login?next=' + encodeURIComponent(p + url.search));
    try {
      const boot = p === '/lab'
        ? await callGas('getLabBoot', null, staff)
        : await getBootCached(bootParams(url, { staff: '1' }), staff);
      return send(res, 200, await withBoot(p === '/lab' ? 'lab.html' : 'index.html', boot));
    } catch (err) { console.error(p, err.message); return send(res, 503, errorPage(err.message)); }
  }

  if (req.method === 'GET' && p === '/login') return send(res, 200, tpl('login.html'));
  if (req.method === 'GET' && p === '/logout') return redirect(res, '/login', { 'Set-Cookie': cookieHeader(req, '', 0) });

  /* Staff login: email a code, then check it */
  if (req.method === 'POST' && (p === '/auth/send-code' || p === '/auth/check-code')) {
    if (limited('auth:' + ipOf(req), 20, 15 * 60000)) return json(res, 429, { ok: false, error: 'Too many tries. Wait 15 minutes and try again.' });
    if (PREVIEW) return json(res, 400, { ok: false, error: 'Staff login only works once the site is connected to the Google Sheet.' });
    try {
      const body = await readBody(req, 4096);
      if (p === '/auth/send-code') return json(res, 200, { ok: true, result: await callGas('sendStaffCode', { email: body.email }, '') });
      const r = await callGas('checkStaffCode', { email: body.email, code: body.code }, '');
      return json(res, 200, { ok: true, result: { email: r.email } }, { 'Set-Cookie': cookieHeader(req, makeStaffCookie(r.email), STAFF_HOURS * 3600) });
    } catch (err) { return json(res, 200, { ok: false, error: err.message }); }
  }

  /* Everything the page does: passed on to Apps Script */
  const api = p.match(/^\/api\/([A-Za-z]+)$/);
  if (api && req.method === 'POST') {
    const fn = api[1];
    if (!PUBLIC_FNS.has(fn) && !STAFF_FNS.has(fn)) return json(res, 404, { ok: false, error: 'Unknown action.' });
    if (limited('api:' + ipOf(req), 240, 60000)) return json(res, 429, { ok: false, error: 'Too many requests. Please wait a moment.' });
    // Staff identity only travels when the request comes from the staff or lab page.
    const staff = req.headers['x-staff-mode'] === '1' ? readStaff(req) : '';
    if (STAFF_FNS.has(fn) && !staff) return json(res, 200, { ok: false, error: 'Staff login required. Open the staff link and log in again.' });
    try {
      const body = await readBody(req);
      return json(res, 200, { ok: true, result: await callGas(fn, body.arg, staff) });
    } catch (err) {
      if (!err.expected) console.error(fn, err.message);
      return json(res, 200, { ok: false, error: err.message });
    }
  }

  return send(res, 404, errorPage('This page does not exist.'));
}

http.createServer((req, res) => {
  handle(req, res).catch(err => { console.error(err); try { send(res, 500, errorPage('Something went wrong.')); } catch (e) {} });
}).listen(PORT, () => console.log(`Order site listening on ${PORT}${PREVIEW ? ' (preview mode)' : ''}`));

