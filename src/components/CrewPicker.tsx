"use client";

import { useState } from "react";
import { Check, Plus, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Operator } from "@/lib/types";

type Props = {
  operators: Operator[];
  value: string[];
  onChange: (ids: string[]) => void;
  onOperatorsChanged: () => void;
};

export default function CrewPicker({
  operators,
  value,
  onChange,
  onOperatorsChanged,
}: Props) {
  const [showOther, setShowOther] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  }

  /** Add a name that is not on the list, then select it. */
  async function addOther() {
    const clean = name.trim();
    if (!clean) return;
    setAdding(true);
    try {
      const hit = operators.find(
        (o) => o.name.toLowerCase() === clean.toLowerCase()
      );
      if (hit) {
        if (!value.includes(hit.id)) onChange([...value, hit.id]);
      } else {
        const { data, error } = await supabase
          .from("operators")
          .insert({ name: clean })
          .select()
          .single();
        if (!error && data) {
          onChange([...value, (data as Operator).id]);
          onOperatorsChanged();
        }
      }
      setName("");
      setShowOther(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <span className="field-label">
        <Users size={14} />
        Who is working on this
      </span>

      <div className="chips">
        {operators.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id}
              className="chip"
              aria-pressed={on}
              onClick={() => toggle(o.id)}
            >
              {on && (
                <span className="chip-check">
                  <Check size={14} />
                </span>
              )}
              {o.name}
            </button>
          );
        })}
        <button
          className="chip"
          aria-pressed={showOther}
          onClick={() => setShowOther((v) => !v)}
        >
          <Plus size={14} style={{ verticalAlign: -2 }} /> Other
        </button>
      </div>

      {showOther && (
        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Type the name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addOther()}
          />
          <button
            className="btn primary"
            disabled={!name.trim() || adding}
            onClick={() => void addOther()}
          >
            Add
          </button>
        </div>
      )}

      <div className="crew-count">
        {value.length === 0
          ? "Tap one or more names. Tap again to remove."
          : `${value.length} ${value.length === 1 ? "person" : "people"} selected`}
      </div>
    </div>
  );
}
