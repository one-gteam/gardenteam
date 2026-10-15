"use client";

import { useState } from "react";

/**
 * Reparto nella richiesta di registrazione: obbligatorio, con «Altro» per chi
 * non lavora in un reparto (amministratori, gestori, grafici…). Con «Altro» si
 * apre una riga per dire in due parole di cosa si occupa: aiuta chi approva a
 * dare il ruolo giusto.
 */
export default function RepartoScelta({ reparti }: { reparti: { id: string; nome: string }[] }) {
  const [altro, setAltro] = useState(false);
  return (
    <>
      <label className="field">
        Reparto
        <select name="departmentId" defaultValue="" required onChange={(e) => setAltro(e.target.value === "altro")}>
          <option value="" disabled>— Scegli —</option>
          {reparti.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          <option value="altro">Altro</option>
        </select>
      </label>
      {altro && (
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Di cosa ti occupi?
          <input type="text" name="notaAltro" maxLength={300} placeholder="es. amministrazione, responsabile del punto vendita, grafica…" />
        </label>
      )}
    </>
  );
}
