"use client";

import { useState } from "react";
import SubAbas from "@/components/SubAbas";
import ControleSla from "@/components/saude/ControleSla";
import RadarChurn from "@/components/saude/RadarChurn";

/* ============================== SAÚDE: Radar de Churn + Controle SLA ============================== */

export default function HealthScorePage() {
  const [aba, setAba] = useState<"score" | "sla">("score");
  return (
    <div>
      <SubAbas
        abas={[{ v: "score", label: "Radar de Churn" }, { v: "sla", label: "Controle SLA" }]}
        ativa={aba}
        onChange={setAba}
      />
      {aba === "sla" ? <ControleSla /> : <RadarChurn />}
    </div>
  );
}
