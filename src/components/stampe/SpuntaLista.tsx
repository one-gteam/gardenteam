"use client";

/**
 * Pulsantino «nome della lista (n)» sopra l'elenco Da stampare più tardi:
 * spunta i cartelli di quella lista (e toglie le altre spunte del modulo),
 * così si stampa solo quella. Un secondo clic toglie le spunte.
 */
export default function SpuntaLista({ lista, n, campo = "lista", titolo }: {
  lista: string; n: number;
  /** quale data-… delle caselle guardare: la lista, chi l'ha messo («utente»), il giorno («giorno») */
  campo?: "lista" | "utente" | "giorno"; titolo?: string;
}) {
  return (
    <button type="button" className="chip"
      title={titolo ?? `Spunta solo i cartelli della lista «${lista}»`}
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="coda"]'));
        const suoi = boxes.filter((b) => b.dataset[campo] === lista);
        const giaSpuntata = suoi.length > 0 && suoi.every((b) => b.checked) && boxes.every((b) => b.checked === (b.dataset[campo] === lista));
        for (const b of boxes) b.checked = !giaSpuntata && b.dataset[campo] === lista;
      }}>
      {lista} <span className="pill pill-gray" style={{ marginLeft: 4 }}>{n}</span>
    </button>
  );
}
