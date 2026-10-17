'use client';

import type { Problem, ProfileSchemas } from '@sozhiteli/api-client';
import { useEffect, useState } from 'react';

import { ProfileForm } from '@/components/profile-form';
import { RequireAuth } from '@/components/require-auth';
import { ErrorMessage, Loading } from '@/components/states';
import { useApi } from '@/lib/api';
import { useCities, useQuestionnaire } from '@/lib/reference';

type Profile = ProfileSchemas['Profile'];

function ProfileScreen() {
  const api = useApi();
  const questionnaire = useQuestionnaire();
  const cities = useCities();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.profile.GET('/v1/me/profile').then(({ data, error }) => {
      if (cancelled) return;
      if (data) setProfile(data);
      else if (error?.code === 'profile_not_found') setProfile(null);
      else setProblem(error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (problem) return <ErrorMessage problem={problem} />;
  if (questionnaire.error !== undefined) return <ErrorMessage problem={questionnaire.error} />;
  if (cities.error !== undefined) return <ErrorMessage problem={cities.error} />;
  if (profile === undefined || !questionnaire.data || !cities.data) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>{profile ? 'Моя анкета' : 'Создайте анкету'}</h1>
      </div>
      {profile === null && (
        <p className="info mb-16">
          Заполните анкету — после этого вы увидите подходящих соседей, а они вас. Это займёт пару минут.
        </p>
      )}
      <ProfileForm
        initial={profile}
        questionnaire={questionnaire.data}
        cities={cities.data}
        onSaved={setProfile}
      />
    </>
  );
}

export default function ProfilePage() {
  return (
    <main className="page page-narrow">
      <RequireAuth>
        <ProfileScreen />
      </RequireAuth>
    </main>
  );
}
