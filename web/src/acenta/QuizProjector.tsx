import { useEffect, useState } from "react";

export interface QuizSlide {
  question: string;
  options: string[];
  correct_index: number;
  explanation?: string;
  timer_seconds?: number;
}

export function QuizProjector({
  title,
  slides,
  onClose,
}: {
  title: string;
  slides: QuizSlide[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const current = slides[index] ?? slides[0];
  const [secondsLeft, setSecondsLeft] = useState(current?.timer_seconds ?? 30);
  const [timerRunning, setTimerRunning] = useState(false);

  useEffect(() => {
    setRevealed(false);
    setSecondsLeft(slides[index]?.timer_seconds ?? 30);
    setTimerRunning(false);
  }, [index, slides]);

  useEffect(() => {
    if (!timerRunning || secondsLeft <= 0) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, secondsLeft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setRevealed((r) => !r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onClose]);

  if (!current) return null;

  return (
    <div
      className="quiz-projector-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Proyector: ${title}`}
    >
      <header className="quiz-projector-header">
        <div>
          <span className="quiz-projector-kicker">{title}</span>
          <strong>
            Pregunta {index + 1} de {slides.length}
          </strong>
        </div>
        <div className="quiz-projector-controls">
          <button
            type="button"
            className="quiz-proj-btn"
            onClick={() => setTimerRunning((r) => !r)}
          >
            ⏱ {secondsLeft}s {timerRunning ? "Pausar" : "Iniciar"}
          </button>
          <button
            type="button"
            className="quiz-proj-btn"
            onClick={onClose}
          >
            Salir (Esc)
          </button>
        </div>
      </header>

      <main className="quiz-projector-stage">
        <h2 className="quiz-projector-question">{current.question}</h2>
        <div className="quiz-projector-options">
          {current.options.map((opt, idx) => {
            const isCorrect = idx === current.correct_index;
            return (
              <div
                key={idx}
                className={`quiz-projector-option${
                  revealed && isCorrect ? " is-correct" : ""
                }${revealed && !isCorrect ? " is-dim" : ""}`}
              >
                <span className="quiz-projector-letter">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span>{opt}</span>
              </div>
            );
          })}
        </div>

        {revealed && current.explanation && (
          <div className="quiz-projector-explanation" role="status">
            <strong>Explicación:</strong> {current.explanation}
          </div>
        )}
      </main>

      <footer className="quiz-projector-footer">
        <button
          type="button"
          className="quiz-proj-btn"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          ← Anterior
        </button>
        <button
          type="button"
          className="quiz-proj-btn is-primary"
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? "Ocultar respuesta" : "Revelar respuesta (Espacio)"}
        </button>
        <button
          type="button"
          className="quiz-proj-btn"
          disabled={index >= slides.length - 1}
          onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
        >
          Siguiente →
        </button>
      </footer>
    </div>
  );
}
