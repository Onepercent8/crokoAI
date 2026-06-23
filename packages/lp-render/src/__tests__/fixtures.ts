/**
 * Test fixtures — valid raw inputs for ContentDoc. Uses template placeholders
 * (Acme / example.com / curso-exemplo) per project rules — never real brands.
 */

export function validTheme() {
  return {
    palette: {
      primary: '#1d4ed8',
      secondary: '#9333ea',
      background: '#ffffff',
      foreground: '#0f172a',
      accent: '#f59e0b',
    },
    typography: { headingFont: 'Inter', bodyFont: 'Inter' },
    radius: 'md' as const,
    shadow: 'sm' as const,
  };
}

export function validSettings() {
  return {
    locale: 'pt' as const,
    title: 'Curso Exemplo — Acme',
    metaDescription: 'Aprenda com o curso-exemplo da Acme.',
    noindex: true,
    checkoutUrl: 'https://checkout.example.com/curso-exemplo',
    priceCents: 19700,
  };
}

export function validSections() {
  return [
    {
      type: 'hero',
      position: 0,
      enabled: true,
      version: 1,
      fields: {
        eyebrow: 'Novo',
        headline: 'Transforme sua carreira com o curso-exemplo',
        subheadline: 'Da Acme, para você.',
        primaryCta: { label: 'Quero entrar', href: 'https://checkout.example.com/curso-exemplo' },
      },
    },
    {
      type: 'faq',
      position: 1,
      enabled: true,
      version: 1,
      fields: {
        title: 'Perguntas frequentes',
        items: [{ question: 'Tem garantia?', answer: 'Sim, 7 dias.' }],
      },
    },
    {
      type: 'pricing',
      position: 2,
      enabled: true,
      version: 1,
      fields: {
        title: 'Planos',
        plans: [
          {
            name: 'Padrão',
            priceCents: 19700,
            period: 'único',
            features: ['Acesso vitalício'],
            cta: { label: 'Comprar', href: 'https://checkout.example.com/curso-exemplo' },
            highlighted: true,
          },
        ],
      },
    },
  ];
}

export function validRawDoc() {
  return {
    settings: validSettings(),
    theme: validTheme(),
    sections: validSections(),
  };
}
