'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { avatarTone } from '@/components/avatar';
import { Loading } from '@/components/states';
import { useAuth } from '@/lib/auth';

const features = [
  {
    icon: '🏠',
    tone: 'soft-primary',
    title: 'Только подходящие по условиям',
    text: 'Город, бюджет, сроки заселения и пол соседа — неподходящих вы просто не увидите.',
  },
  {
    icon: '🧽',
    tone: 'soft-accent',
    title: 'Привычки видно сразу',
    text: 'Уборка, гости, шум, режим сна, курение — 11 вопросов, и вы заранее знаете, о чём договариваться.',
  },
  {
    icon: '🤝',
    tone: 'soft-warning',
    title: 'Контакты — по согласию',
    text: 'Telegram или ВКонтакте открываются, только когда оба захотели продолжить общение.',
  },
];

const preview = [
  { id: 'alina', name: 'Алина', line: 'Совпадает 7 из 8', budget: '12 000 – 15 000 ₽' },
  { id: 'p2', name: 'Максим', line: 'Совпадает 5 из 8', budget: '10 000 – 13 000 ₽' },
];

export default function HomePage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace('/candidates');
  }, [auth.status, router]);

  if (auth.status !== 'anonymous') {
    return (
      <main className="page">
        <Loading />
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <div className="stack">
          <h1>Найдите соседа, с которым уживётесь</h1>
          <p className="muted lead">
            Заполните короткую анкету об условиях и бытовых привычках — и ещё до первого сообщения увидите, в
            чём вы совпадаете с другими, а о чём придётся договориться.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void auth.signIn()}>
              Найти соседа
            </button>
            <span className="small muted">Регистрация — почта и пароль</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          {preview.map((p) => (
            <div key={p.id} className="tile tile-row">
              <div className={`tile-cover ${avatarTone(p.id)}`}>
                <span className="avatar-initials">{p.name[0]}</span>
              </div>
              <div className="tile-body">
                <span className="tile-title">{p.name}</span>
                <span className="tile-price">{p.budget}</span>
                <span className="chip chip-good">{p.line}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="features">
        {features.map((f) => (
          <div key={f.title} className="feature">
            <span className={`feature-icon ${f.tone}`} aria-hidden="true">
              {f.icon}
            </span>
            <h3>{f.title}</h3>
            <p className="muted">{f.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
