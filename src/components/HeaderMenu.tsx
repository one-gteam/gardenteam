import Link from "next/link";

export interface VoceMenu {
  href: string;
  label: string;
  key: string;
}

/**
 * Il menu della testata, in due vesti che convivono: la riga di link sotto il
 * brand (da computer) e il ☰ a scomparsa (da cellulare, o quando la pagina
 * chiede la testata compatta come "In reparto"). Quale delle due si vede lo
 * decide il CSS, così la pagina resta una sola e i link non si duplicano nei
 * permessi. Chiuso, il ☰ dice a che pagina si è.
 */
export default function HeaderMenu({ voci, active }: { voci: VoceMenu[]; active: string }) {
  const corrente = voci.find((v) => v.key === active)?.label;
  return (
    <>
      <details className="hamburger">
        <summary>☰ {corrente ?? "Menu"}</summary>
        <nav className="nav">
          {voci.map((v) => (
            <Link key={v.key} href={v.href} className={active === v.key ? "active" : ""}>{v.label}</Link>
          ))}
        </nav>
      </details>
      <div className="header-nav-row">
        <nav className="nav">
          {voci.map((v) => (
            <Link key={v.key} href={v.href} className={active === v.key ? "active" : ""}>{v.label}</Link>
          ))}
        </nav>
      </div>
    </>
  );
}
