import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildReportRows, parseColumns, rowsToCsv } from "@/lib/customReport";
import { userSites, isAcademyAdmin } from "@/lib/types";

export async function GET(req: NextRequest) {
  // stesso metro della pagina Report: area formazione e ruolo di gestione
  const user = await getCurrentUser();
  if (!user || !userSites(user).includes("academy") || !isAcademyAdmin(user)) {
    return new NextResponse("Non autorizzato", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const db = await getDb();
  const columns = parseColumns(sp.getAll("col"));
  const rows = buildReportRows(db, user, {
    reparto: sp.get("reparto") || undefined,
    insegna: sp.get("insegna") || undefined,
    corso: sp.get("corso") || undefined,
    stato: sp.get("stato") || undefined,
  });
  const csv = "﻿" + rowsToCsv(rows, columns); // BOM: Excel apre gli accenti correttamente

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="report-formazione.csv"`,
    },
  });
}
