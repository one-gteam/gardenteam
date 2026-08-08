// Costante condivisa tra src/lib/gate.ts (server action, Node runtime) e
// src/middleware.ts (Edge runtime): tenuta in un file a parte senza "use
// server" né import di next/headers, altrimenti il middleware si porterebbe
// dietro l'intero modulo dell'azione server, non compatibile con l'Edge.
export const GATE_COOKIE = "agt_varco";
