import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Header from "@/components/Header";
import { submitQuiz } from "@/lib/actions";
import { getProgress } from "@/lib/logic";

export default async function QuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ esito?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { esito } = await searchParams;

  const db = await getDb();
  const course = db.courses.find((c) => c.id === id);
  if (!course || course.quiz.length === 0) notFound();

  const prog = getProgress(db, user.id, course.id);
  const submitAction = submitQuiz.bind(null, course.id);
  const justSubmitted = esito !== undefined;
  const score = justSubmitted ? Number(esito) : prog?.quizScore;
  const passed = prog?.quizPassed ?? false;
  const myCert = db.certificates.find((c) => c.userId === user.id && c.courseId === course.id);

  return (
    <div>
      <Header user={user} active="studente" />
      <div className="container" style={{ maxWidth: 760 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href={`/corso/${course.id}`}>← Torna al corso</Link>
        </div>
        <h1>🧠 Quiz finale — {course.title}</h1>
        <p className="subtitle">
          {course.quiz.length} domande · soglia di superamento {course.passScore}% · +30 punti se superato
        </p>

        {justSubmitted && (
          <div className={`alert ${passed ? "alert-green" : "alert-amber"}`}>
            {passed ? (
              <>
                🎉 <strong>Quiz superato con {score}%!</strong>
                {score === 100 && " Punteggio perfetto! 🏆"}
                {myCert && (
                  <>
                    {" "}
                    <a href={`/certificato/${myCert.id}`}>Vai al tuo certificato →</a>
                  </>
                )}
                {!myCert && " Completa tutte le lezioni per ottenere il certificato."}
              </>
            ) : (
              <>
                😕 <strong>Punteggio: {score}%.</strong> Serve almeno il {course.passScore}% — ripassa le lezioni e riprova, hai tentativi illimitati.
              </>
            )}
          </div>
        )}

        {passed && !justSubmitted && (
          <div className="alert alert-green">
            ✓ Hai già superato questo quiz con <strong>{prog?.quizScore}%</strong>.
          </div>
        )}

        {!passed && (
          <form action={submitAction} className="card">
            {course.quiz.map((q, qi) => (
              <div className="quiz-q" key={q.id}>
                <div className="q-text">
                  {qi + 1}. {q.text}
                </div>
                {q.options.map((opt, oi) => (
                  <label className="quiz-opt" key={oi}>
                    <input type="radio" name={q.id} value={oi} required />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
            <button className="btn" type="submit">Consegna il quiz</button>
          </form>
        )}
      </div>
    </div>
  );
}
