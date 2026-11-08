// join-qr.js -- Generic helper: draws a QR code that opens the join page with
// the room code pre-filled (/?room=CODE). Used by the lobby, and any game can
// reuse it on its own screen (e.g. so people can join a running game).
// Needs the small "qrcodejs" library loaded in host.html; without it, nothing
// is drawn (the code stays readable on screen anyway).
window.JoinQR = {
  url(code) { return location.origin + "/?room=" + encodeURIComponent(code); },
  draw(el, code, size) {
    if (!el || !code) return;
    if (!document.getElementById("gn-qr-style")) {
      const st = document.createElement("style"); st.id = "gn-qr-style";
      st.textContent = ".join-qr{display:inline-block;background:#fff;padding:8px;border-radius:12px;margin-top:10px;line-height:0}" +
        ".join-qr img,.join-qr canvas{display:block}";
      document.head.appendChild(st);
    }
    el.innerHTML = "";
    if (typeof window.QRCode !== "function") { el.hidden = true; return; }
    el.hidden = false;
    new window.QRCode(el, {
      text: this.url(code), width: size || 140, height: size || 140,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : undefined,
    });
  },
};
