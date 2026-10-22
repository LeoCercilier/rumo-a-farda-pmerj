"use client";

import { useEffect, useState } from "react";

const areas = [
  { id: "inicio", icon: "⌂", title: "Início", detail: "Seu painel de preparação" },
  { id: "disciplinas", icon: "▤", title: "Disciplinas", detail: "Organize o conteúdo por matéria" },
  { id: "questoes", icon: "☷", title: "Questões", detail: "Pratique e confira suas respostas" },
  { id: "simulados", icon: "◷", title: "Simulados", detail: "Treine com tempo marcado" },
  { id: "desempenho", icon: "↗", title: "Desempenho", detail: "Acompanhe sua evolução" },
  { id: "revisao", icon: "✦", title: "Revisão", detail: "Revise seus pontos importantes" }
];

const subjects = [
  { name: "Língua Portuguesa", description: "Interpretação de texto e gramática", progress: 0 },
  { name: "Matemática", description: "Fundamentos e resolução de problemas", progress: 0 },
  { name: "Legislação", description: "Conteúdo a confirmar no edital aplicável", progress: 0 },
  { name: "História e Geografia", description: "Tópicos a confirmar no edital aplicável", progress: 0 }
];

const questions = [
  {
    id: "portugues-01",
    subject: "Língua Portuguesa",
    prompt: "Qual alternativa apresenta uma frase de acordo com a norma-padrão?",
    options: [
      ["a", "Fazem dois anos que comecei a estudar."],
      ["b", "Havia muitos candidatos na sala."],
      ["c", "Existe muitas formas de aprender."],
      ["d", "Os aluno chegaram cedo."]
    ],
    correctAnswer: "b",
    explanation: "O verbo haver, com sentido de existir, é impessoal e fica na terceira pessoa do singular."
  },
  {
    id: "matematica-01",
    subject: "Matemática",
    prompt: "Um candidato acertou 18 de 20 questões. Qual foi o percentual de acertos?",
    options: [
      ["a", "80%"],
      ["b", "85%"],
      ["c", "90%"],
      ["d", "95%"]
    ],
    correctAnswer: "c",
    explanation: "18 dividido por 20 é igual a 0,9. Multiplicando por 100, obtemos 90%."
  },
  {
    id: "portugues-02",
    subject: "Língua Portuguesa",
    prompt: "Qual palavra está escrita corretamente?",
    options: [
      ["a", "Excessão"],
      ["b", "Concerteza"],
      ["c", "Privilégio"],
      ["d", "Beneficiente"]
    ],
    correctAnswer: "c",
    explanation: "A grafia correta é privilégio. As demais formas apresentadas estão incorretas."
  },
  {
    id: "matematica-02",
    subject: "Matemática",
    prompt: "Quanto é 15% de 200?",
    options: [
      ["a", "15"],
      ["b", "20"],
      ["c", "25"],
      ["d", "30"]
    ],
    correctAnswer: "d",
    explanation: "10% de 200 é 20 e 5% é 10. Portanto, 15% corresponde a 30."
  }
];

export default function Home() {
  const [active, setActive] = useState("inicio");
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [subjectFilter, setSubjectFilter] = useState("Todas");
  const filteredQuestions = subjectFilter === "Todas"
    ? questions
    : questions.filter((question) => question.subject === subjectFilter);
  const currentQuestion = filteredQuestions[questionIndex] ?? filteredQuestions[0];
  const [errorIds, setErrorIds] = useState<string[]>([]);
  const [errorsLoaded, setErrorsLoaded] = useState(false);
  const [simStatus, setSimStatus] = useState<"ready" | "running" | "finished">("ready");
  const [simIndex, setSimIndex] = useState(0);
  const [simAnswers, setSimAnswers] = useState<Record<string, string>>({});
  const [simSeconds, setSimSeconds] = useState(600);
  const [simHistory, setSimHistory] = useState<Array<{
    id: string;
    date: string;
    correct: number;
    attempted: number;
    total: number;
    percent: number;
  }>>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const simQuestion = questions[simIndex];
  const simCorrect = questions.filter(
    (question) => simAnswers[question.id] === question.correctAnswer
  ).length;
  const simAttempted = questions.filter(
    (question) => Boolean(simAnswers[question.id])
  ).length;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rumo-a-farda-stats-v1");
      if (saved) {
        const data = JSON.parse(saved);
        if (Number.isInteger(data.totalAnswered) && data.totalAnswered >= 0) {
          setTotalAnswered(data.totalAnswered);
        }
        if (Number.isInteger(data.totalCorrect) && data.totalCorrect >= 0) {
          setTotalCorrect(data.totalCorrect);
        }
      }
    } catch (error) {
      console.error("Não foi possível carregar o progresso salvo.", error);
    } finally {
      setStatsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!statsLoaded) return;
    try {
      localStorage.setItem(
        "rumo-a-farda-stats-v1",
        JSON.stringify({ totalAnswered, totalCorrect })
      );
    } catch (error) {
      console.error("Não foi possível salvar o progresso.", error);
    }
  }, [statsLoaded, totalAnswered, totalCorrect]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rumo-a-farda-errors-v1");
      if (saved) {
        const data: unknown = JSON.parse(saved);
        if (
          Array.isArray(data) &&
          data.every((id) => typeof id === "string")
        ) {
          setErrorIds([...new Set(data)].filter((id) =>
            questions.some((question) => question.id === id)
          ));
        }
      }
    } catch (error) {
      console.error("Não foi possível carregar o caderno de erros.", error);
    } finally {
      setErrorsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!errorsLoaded) return;
    try {
      localStorage.setItem("rumo-a-farda-errors-v1", JSON.stringify(errorIds));
    } catch (error) {
      console.error("Não foi possível salvar o caderno de erros.", error);
    }
  }, [errorsLoaded, errorIds]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rumo-a-farda-sim-history-v1");
      if (saved) {
        const data: unknown = JSON.parse(saved);
        if (Array.isArray(data)) {
          const valid = data.filter((item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.date === "string" &&
            Number.isInteger(item.correct) &&
            Number.isInteger(item.attempted) &&
            Number.isInteger(item.total) &&
            Number.isInteger(item.percent) &&
            item.correct >= 0 &&
            item.attempted >= 0 &&
            item.total > 0 &&
            item.percent >= 0 &&
            item.percent <= 100
          );
          setSimHistory(valid.slice(0, 50));
        }
      }
    } catch (error) {
      console.error("Não foi possível carregar o histórico de simulados.", error);
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      localStorage.setItem(
        "rumo-a-farda-sim-history-v1",
        JSON.stringify(simHistory.slice(0, 50))
      );
    } catch (error) {
      console.error("Não foi possível salvar o histórico de simulados.", error);
    }
  }, [historyLoaded, simHistory]);

  const accuracy =
    totalAnswered > 0
      ? Math.round((totalCorrect / totalAnswered) * 100)
      : null;

  const checkAnswer = () => {
    if (!answer || checked) return;

    const isCorrect = answer === currentQuestion.correctAnswer;
    setTotalAnswered((value) => value + 1);

    if (isCorrect) {
      setTotalCorrect((value) => value + 1);
      setErrorIds((ids) => ids.filter((id) => id !== currentQuestion.id));
    } else {
      setErrorIds((ids) =>
        ids.includes(currentQuestion.id) ? ids : [...ids, currentQuestion.id]
      );
    }

    setChecked(true);
  };

  const goToQuestion = (index: number) => {
    if (filteredQuestions.length === 0) return;
    setQuestionIndex((index + filteredQuestions.length) % filteredQuestions.length);
    setAnswer("");
    setChecked(false);
  };

  const changeSubjectFilter = (subject: string) => {
    setSubjectFilter(subject);
    setQuestionIndex(0);
    setAnswer("");
    setChecked(false);
  };

  const finishSimulation = () => {
    if (simStatus !== "running") return;

    const correct = questions.filter(
      (question) => simAnswers[question.id] === question.correctAnswer
    ).length;
    const attempted = questions.filter(
      (question) => Boolean(simAnswers[question.id])
    ).length;

    setTotalAnswered((value) => value + attempted);
    setTotalCorrect((value) => value + correct);
    setErrorIds((ids) => {
      const next = new Set(ids);
      questions.forEach((question) => {
        if (simAnswers[question.id] === question.correctAnswer) {
          next.delete(question.id);
        } else {
          next.add(question.id);
        }
      });
      return [...next];
    });

    setSimHistory((history) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: new Date().toISOString(),
        correct,
        attempted,
        total: questions.length,
        percent: Math.round((correct / questions.length) * 100)
      },
      ...history
    ].slice(0, 50));

    setSimStatus("finished");
  };

  useEffect(() => {
    if (simStatus !== "running") return;
    const timer = window.setInterval(() => {
      setSimSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [simStatus]);

  useEffect(() => {
    if (simStatus !== "running" || simSeconds !== 0) return;
    finishSimulation();
  }, [simSeconds, simStatus]);

  const current = areas.find((area) => area.id === active) ?? areas[0];

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setActive("inicio"); }}>
          <span className="brand-mark">RF</span>
          <span><strong>RUMO À FARDA</strong><small>PREPARAÇÃO PMERJ</small></span>
        </a>

        <p className="menu-label">MENU PRINCIPAL</p>
        <nav className="navigation" aria-label="Navegação principal">
          {areas.map((area) => (
            <button
              key={area.id}
              className={`nav-item ${active === area.id ? "selected" : ""}`}
              onClick={() => { setActive(area.id); setAnswer(""); setChecked(false); }}
            >
              <span className="nav-icon">{area.icon}</span>
              <span>{area.title}</span>
              {active === area.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="note-star">✦</span>
          <strong>Um dia de cada vez.</strong>
          <p>A constância transforma esforço em evolução.</p>
        </div>
        <small className="sidebar-footer">RUMO À FARDA © 2026</small>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <span className="breadcrumb">SUA JORNADA /</span>
            <span className="breadcrumb-current"> {current.title.toUpperCase()}</span>
          </div>
          <span className="user-avatar">RF</span>
        </header>

        {active === "inicio" && (
          <>
            <section className="welcome">
              <div>
                <span className="eyebrow"><span className="live-dot" /> FOCO • DISCIPLINA • CONSTÂNCIA</span>
                <h1>Sua aprovação começa<br />com <em>o próximo passo.</em></h1>
                <p>Organize sua preparação, pratique e acompanhe sua evolução rumo à PMERJ.</p>
                <button className="primary-button" onClick={() => setActive("disciplinas")}>ACESSAR DISCIPLINAS <span>→</span></button>
              </div>
              <div className="welcome-art">
                <div className="art-circle">RF</div>
                <span>MISSÃO</span><strong>FOCO NO<br />SEU OBJETIVO</strong>
              </div>
            </section>

            <div className="section-title"><div><span className="eyebrow dark-eyebrow">VISÃO GERAL</span><h2>Sua preparação</h2></div><span className="demo-label">PAINEL INICIAL</span></div>

            <section className="stats-grid">
              <article className="stat-card"><span className="stat-icon">▤</span><small>Disciplinas</small><strong>04</strong><span className="stat-foot">na estrutura inicial</span></article>
              <article className="stat-card"><span className="stat-icon">☷</span><small>Questões respondidas</small><strong>{totalAnswered}</strong><span className="stat-foot">salvas neste aparelho</span></article>
              <article className="stat-card"><span className="stat-icon">↗</span><small>Seu desempenho</small><strong>{accuracy === null ? "—" : `${accuracy}%`}</strong><span className="stat-foot">taxa de acerto</span></article>
            </section>

            <section className="content-panel">
              <div className="panel-heading"><div><span className="eyebrow dark-eyebrow">COMECE POR AQUI</span><h2>Áreas de estudo</h2></div><button className="text-button" onClick={() => setActive("disciplinas")}>Ver todas ↗</button></div>
              <div className="subject-grid">
                {subjects.map((subject, index) => (
                  <button className="subject-card" key={subject.name} onClick={() => setActive("disciplinas")}>
                    <span className="subject-number">0{index + 1}</span><h3>{subject.name}</h3><p>{subject.description}</p><span className="card-arrow">↗</span>
                  </button>
                ))}
              </div>
              <p className="disclaimer">Estrutura demonstrativa. Os conteúdos deverão ser confirmados conforme o edital oficial aplicável à seleção da PMERJ.</p>
            </section>
          </>
        )}

        {active === "disciplinas" && (
          <section className="page-content">
            <span className="eyebrow dark-eyebrow">CONTEÚDO ORGANIZADO</span>
            <h1>Disciplinas</h1><p className="page-intro">Construa sua base de conhecimento, uma matéria por vez.</p>
            <div className="subject-grid">
              {subjects.map((subject, index) => (
                <article className="subject-card" key={subject.name}>
                  <span className="subject-number">0{index + 1}</span><h3>{subject.name}</h3><p>{subject.description}</p>
                  <div className="progress-track"><span style={{ width: `${subject.progress}%` }} /></div>
                  <small className="progress-caption">Progresso inicial: 0%</small>
                  <button className="secondary-button" onClick={() => setActive("questoes")}>Praticar questões →</button>
                </article>
              ))}
            </div>
            <p className="disclaimer">A lista é provisória e não representa uma confirmação das matérias cobradas em edital.</p>
          </section>
        )}

        {active === "questoes" && (
          <section className="page-content">
            <span className="eyebrow dark-eyebrow">TREINO DE CONHECIMENTO</span>
            <h1>Banco de questões</h1>
            <p className="page-intro">Escolha uma disciplina para praticar.</p>
            <div className="filter-row" aria-label="Filtrar questões por disciplina">
              {["Todas", "Língua Portuguesa", "Matemática"].map((subject) => (
                <button
                  key={subject}
                  type="button"
                  className={`secondary-button ${subjectFilter === subject ? "filter-selected" : ""}`}
                  aria-pressed={subjectFilter === subject}
                  onClick={() => changeSubjectFilter(subject)}
                >
                  {subject}
                </button>
              ))}
            </div>
            <p className="page-intro">
              Questão {questionIndex + 1} de {filteredQuestions.length}. Responda e confira a explicação.
            </p>
            <article className="question-card">
              <span className="question-tag">{currentQuestion.subject.toUpperCase()} • QUESTÃO AUTORAL</span>
              <h2>{currentQuestion.prompt}</h2>
              {currentQuestion.options.map(([letter, label]) => (
                <button
                  key={letter}
                  className={`answer-option ${answer === letter ? "answer-selected" : ""} ${checked && letter === currentQuestion.correctAnswer ? "answer-correct" : ""} ${checked && answer === letter && letter !== currentQuestion.correctAnswer ? "answer-wrong" : ""}`}
                  disabled={checked}
                  onClick={() => setAnswer(letter)}
                >
                  <span>{letter.toUpperCase()}</span>{label}
                </button>
              ))}
              {!checked ? (
                <button className="primary-button" disabled={!answer} onClick={checkAnswer}>
                  CONFERIR RESPOSTA →
                </button>
              ) : (
                <div className={`feedback ${answer === currentQuestion.correctAnswer ? "feedback-correct" : "feedback-wrong"}`}>
                  <strong>{answer === currentQuestion.correctAnswer ? "Resposta correta!" : "Resposta incorreta. Revise o conteúdo."}</strong>
                  <p>{currentQuestion.explanation}</p>
                  <button
                    className="primary-button"
                    onClick={() => goToQuestion(questionIndex + 1)}
                  >
                    PRÓXIMA QUESTÃO →
                  </button>
                </div>
              )}
              <p className="disclaimer">
                Questões autorais para prática. Este banco inicial não representa o conteúdo oficial completo da prova.
              </p>
            </article>
            <p className="disclaimer">
              Seu progresso e caderno de erros ficam salvos neste navegador.
            </p>
          </section>
        )}

        {active === "simulados" && (
          <section className="page-content">
            <span className="eyebrow dark-eyebrow">PREPARE-SE PARA A PROVA</span>
            <h1>Simulados</h1>
            <p className="page-intro">
              Responda às questões, acompanhe o tempo e confira seu resultado no final.
            </p>

            <article className="feature-card simulado-history">
              <h2>Histórico de simulados</h2>
              <p className="page-intro">
                Acompanhe seus resultados e sua evolução.
              </p>

              {simHistory.length === 0 ? (
                <p className="disclaimer">
                  Nenhuma tentativa registrada. Conclua um simulado para começar seu histórico.
                </p>
              ) : (
                <>
                  <div className="history-summary">
                    <span>Melhor aproveitamento</span>
                    <strong>
                      {Math.max(...simHistory.map((item) => item.percent))}%
                    </strong>
                  </div>

                  <div className="simulado-history-list">
                    {simHistory
                      .slice(0, showAllHistory ? 50 : 5)
                      .map((item, index) => (
                        <div className="simulado-history-item" key={item.id}>
                          <div>
                            <strong>
                              Simulado {simHistory.length - index}
                            </strong>
                            {item.percent === Math.max(...simHistory.map((entry) => entry.percent)) && (
                              <span className="history-best-label">
                                Melhor resultado
                              </span>
                            )}
                            <p>{new Date(item.date).toLocaleString("pt-BR")}</p>
                            <small>
                              {item.correct} acerto(s) · {item.attempted}/{item.total} respondida(s)
                            </small>
                          </div>
                          <strong className="simulado-history-score">
                            {item.percent}%
                          </strong>
                        </div>
                      ))}
                  </div>

                  {simHistory.length > 5 && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowAllHistory((value) => !value)}
                    >
                      {showAllHistory
                        ? "Mostrar somente as 5 últimas"
                        : `Ver todas as ${simHistory.length} tentativas`}
                    </button>
                  )}

                  <button
                    type="button"
                    className="secondary-button history-clear-button"
                    onClick={() => setConfirmClearHistory(true)}
                  >
                    Limpar histórico
                  </button>

                  {confirmClearHistory && (
                    <div className="history-confirm" role="alert">
                      <strong>Apagar todas as tentativas?</strong>
                      <p>
                        Essa ação não pode ser desfeita. Seu progresso geral e caderno de erros serão mantidos.
                      </p>
                      <div className="history-confirm-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setConfirmClearHistory(false)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => {
                            setSimHistory([]);
                            setShowAllHistory(false);
                            setConfirmClearHistory(false);
                          }}
                        >
                          Confirmar exclusão
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              <p className="disclaimer">
                São mantidas até 50 tentativas neste navegador. O histórico não é sincronizado entre dispositivos.
              </p>
            </article>

            {simStatus === "ready" && (
              <article className="feature-card">
                <span className="feature-symbol">◷</span>
                <h2>Simulado de prática</h2>
                <ul>
                  <li>{questions.length} questões autorais</li>
                  <li>Tempo máximo: 10 minutos</li>
                  <li>Correção e explicações ao finalizar</li>
                  <li>Resultado integrado ao seu desempenho</li>
                </ul>
                <button
                  className="primary-button"
                  onClick={() => {
                    setSimIndex(0);
                    setSimAnswers({});
                    setSimSeconds(600);
                    setSimStatus("running");
                  }}
                >
                  INICIAR SIMULADO →
                </button>
                <p className="disclaimer">
                  Exercício autoral de demonstração. Não representa a prova oficial completa da PMERJ.
                </p>
              </article>
            )}

            {simStatus === "running" && (
              <article className="question-card">
                <div className="simulado-topline">
                  <span className="question-tag">
                    QUESTÃO {simIndex + 1} DE {questions.length}
                  </span>
                  <strong className={simSeconds <= 60 ? "timer-warning" : "simulado-timer"}>
                    TEMPO {Math.floor(simSeconds / 60).toString().padStart(2, "0")}:
                    {(simSeconds % 60).toString().padStart(2, "0")}
                  </strong>
                </div>
                <div className="simulado-progress">
                  <span style={{ width: `${((simIndex + 1) / questions.length) * 100}%` }} />
                </div>
                <span className="question-tag">{simQuestion.subject.toUpperCase()}</span>
                <h2>{simQuestion.prompt}</h2>
                {simQuestion.options.map(([letter, label]) => (
                  <button
                    key={letter}
                    type="button"
                    className={`answer-option ${
                      simAnswers[simQuestion.id] === letter ? "answer-selected" : ""
                    }`}
                    aria-pressed={simAnswers[simQuestion.id] === letter}
                    onClick={() =>
                      setSimAnswers((answers) => ({
                        ...answers,
                        [simQuestion.id]: letter
                      }))
                    }
                  >
                    <span>{letter.toUpperCase()}</span>{label}
                  </button>
                ))}
                <div className="simulado-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={simIndex === 0}
                    onClick={() => setSimIndex((index) => index - 1)}
                  >
                    ← ANTERIOR
                  </button>
                  {simIndex < questions.length - 1 ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setSimIndex((index) => index + 1)}
                    >
                      PRÓXIMA →
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        if (simStatus !== "running") return;
                        finishSimulation();
                      }}
                    >
                      FINALIZAR SIMULADO →
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary-button simulado-finish"
                  onClick={() => {
                    if (simStatus !== "running") return;
                    finishSimulation();
                  }}
                >
                  Encerrar agora
                </button>
                <p className="disclaimer">
                  Você pode voltar às questões anteriores antes de finalizar. Questões em branco contam como erro no resultado.
                </p>
              </article>
            )}

            {simStatus === "finished" && (
              <>
                <article className="feature-card">
                  <span className="feature-symbol">✓</span>
                  <h2>Resultado do simulado</h2>
                  <div className="stats-grid simulado-results">
                    <div className="stat-card">
                      <small>Acertos</small>
                      <strong>{simCorrect}/{questions.length}</strong>
                    </div>
                    <div className="stat-card">
                      <small>Aproveitamento</small>
                      <strong>{Math.round((simCorrect / questions.length) * 100)}%</strong>
                    </div>
                    <div className="stat-card">
                      <small>Respondidas</small>
                      <strong>{simAttempted}/{questions.length}</strong>
                    </div>
                  </div>
                  <p>
                    {simCorrect === questions.length
                      ? "Excelente! Você acertou todas as questões."
                      : "Revise os comentários abaixo e pratique novamente para evoluir."}
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setSimIndex(0);
                      setSimAnswers({});
                      setSimSeconds(600);
                      setSimStatus("ready");
                    }}
                  >
                    NOVO SIMULADO →
                  </button>
                </article>
                <h2 className="simulado-review-title">Correção das questões</h2>
                {questions.map((question, index) => {
                  const chosen = simAnswers[question.id];
                  const correct = chosen === question.correctAnswer;
                  return (
                    <article className="feature-card" key={question.id}>
                      <span className="question-tag">
                        QUESTÃO {index + 1} • {question.subject.toUpperCase()}
                      </span>
                      <h2>{question.prompt}</h2>
                      <p>
                        <strong>Seu resultado:</strong>{" "}
                        {correct
                          ? "Acertou"
                          : chosen
                            ? `Errou — você marcou ${chosen.toUpperCase()}`
                            : "Não respondida"}
                      </p>
                      <p>
                        <strong>Gabarito:</strong>{" "}
                        {question.correctAnswer.toUpperCase()} —{" "}
                        {question.options.find(
                          ([letter]) => letter === question.correctAnswer
                        )?.[1]}
                      </p>
                      <p>{question.explanation}</p>
                    </article>
                  );
                })}
                <p className="disclaimer">
                  Esta tentativa foi registrada no histórico local deste navegador.
                </p>
              </>
            )}
          </section>
        )}

        {active === "desempenho" && (
          <section className="page-content">
            <span className="eyebrow dark-eyebrow">ACOMPANHE SUA EVOLUÇÃO</span>
            <h1>Desempenho</h1><p className="page-intro">Seus indicadores aparecerão conforme as atividades forem realizadas e registradas.</p>
            <div className="stats-grid"><article className="stat-card"><small>Respondidas</small><strong>{totalAnswered}</strong><span className="stat-foot">tentativas registradas</span></article><article className="stat-card"><small>Taxa de acerto</small><strong>{accuracy === null ? "—" : `${accuracy}%`}</strong><span className="stat-foot">respostas corretas</span></article><article className="stat-card"><small>Tempo de estudo</small><strong>—</strong><span className="stat-foot">registro ainda não ativo</span></article></div>
            <article className="feature-card"><h2>Seu histórico será construído aqui.</h2><p>As respostas e a taxa de acerto são salvas neste navegador. O tempo de estudo e os gráficos ficam para uma próxima etapa.</p><button className="primary-button" onClick={() => setActive("questoes")}>RESPONDER UMA QUESTÃO →</button></article>
          </section>
        )}

        {active === "revisao" && (
          <section className="page-content">
            <span className="eyebrow dark-eyebrow">FIXE O APRENDIZADO</span>
            <h1>Caderno de erros</h1>
            <p className="page-intro">
              Aqui ficam as questões que você errou. Ao acertá-las novamente, elas saem do caderno.
            </p>
            {errorIds.length === 0 ? (
              <article className="feature-card">
                <span className="feature-symbol">✦</span>
                <h2>Nenhuma questão para revisar</h2>
                <p>Quando você errar uma questão, ela aparecerá aqui automaticamente.</p>
                <button className="primary-button" onClick={() => setActive("questoes")}>
                  PRATICAR AGORA →
                </button>
              </article>
            ) : (
              <>
                {errorIds.map((id) => {
                  const question = questions.find((item) => item.id === id);
                  if (!question) return null;
                  return (
                    <article className="feature-card" key={id}>
                      <span className="question-tag">{question.subject.toUpperCase()}</span>
                      <h2>{question.prompt}</h2>
                      <p><strong>Gabarito:</strong> {question.options.find(([letter]) => letter === question.correctAnswer)?.[1]}</p>
                      <p>{question.explanation}</p>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          const index = questions.findIndex((item) => item.id === id);
                          if (index >= 0) {
                            setQuestionIndex(index);
                            setAnswer("");
                            setChecked(false);
                            setActive("questoes");
                          }
                        }}
                      >
                        TENTAR NOVAMENTE →
                      </button>
                    </article>
                  );
                })}
              </>
            )}
          </section>
        )}

        <footer className="footer"><span>RUMO À FARDA © 2026</span><span>DISCIPLINA É SEGUIR, MESMO NOS DIAS DIFÍCEIS.</span></footer>
      </section>
    </main>
  );
}
