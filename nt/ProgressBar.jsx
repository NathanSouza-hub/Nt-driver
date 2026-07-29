import React from "react";

export default function ProgressBar({ percent }) {
  return (
    <div style={{ width: "100%", margin: "16px 0" }}>
      <div
        style={{
          background: "var(--panel-soft)",
          borderRadius: 12,
          height: 16,
          width: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
            height: "100%",
            borderRadius: 12,
            transition: "width 0.4s cubic-bezier(.4,1,.7,1)",
          }}
        />
      </div>
    </div>
  );
}
