import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildReportRows, parseColumns, rowsToCsv } from "@/lib/customReport";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role === "student") return new NextResponse("Non autorizzato", { status: 403 });

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
