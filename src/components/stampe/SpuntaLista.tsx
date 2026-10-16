"use client";

/**
 * Pulsantino «nome della lista (n)» sopra l'elenco Da stampare più tardi:
 * spunta i cartelli di quella lista (e toglie le altre spunte del modulo),
 * così si stampa solo quella. Un secondo clic toglie le spunte.
 */
export default function SpuntaLista({ lista, n }: { lista: string; n: number }) {
  return (
    <button type="button" className="chip"
      title={`Spunta solo i cartelli della lista «${lista}»`}
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="coda"]'));
        const suoi = boxes.filter((b) => b.dataset.lista === lista);
        const giaSpuntata = suoi.length > 0 && suoi.every((b) => b.checked) && boxes.every((b) => b.checked === (b.dataset.lista === lista));
        for (const b of boxes) b.checked = !giaSpuntata && b.dataset.lista === lista;
      }}>
      {lista} <span className="pill pill-gray" style={{ marginLeft: 4 }}>{n}</span>
    </button>
  );
}
