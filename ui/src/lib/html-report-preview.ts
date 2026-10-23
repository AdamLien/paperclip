// Reports are untrusted tenant content. Keep their layout, never their authority
// or network access. The caller must also use an iframe with an empty sandbox.
export function htmlReportPreviewDocument(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,base,meta,link,iframe,frame,frameset,object,embed,form,input,button,textarea,select,animate,animateMotion,animateTransform,set").forEach((node) => node.remove());
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      // Offline raster images are content; external URLs and SVG remain blocked.
      if (name === "src" && element.tagName === "IMG" && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(attribute.value)) continue;
      if (name.startsWith("on") || ["href", "xlink:href", "src", "srcset", "srcdoc", "ping", "action", "formaction", "poster", "background"].includes(name)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{overflow-wrap:anywhere}body{margin:16px}img,table{max-width:100%}</style></head><body>${template.innerHTML}</body></html>`;
}
