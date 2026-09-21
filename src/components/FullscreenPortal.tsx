"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * When an element is put into native fullscreen, the browser paints only that
 * element and its descendants. Anything else in the document, including a
 * modal appended to the body, simply never appears. That is why tapping a bar
 * on the fullscreen floor board looked like nothing happened.
 *
 * This renders its children into whichever element is currently fullscreen,
 * falling back to the body when nothing is.
 */
export default function FullscreenPortal({
  children,
}: {
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const update = () =>
      setTarget(document.fullscreenElement ?? document.body);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  if (!target) return null;
  return createPortal(children, target);
}
