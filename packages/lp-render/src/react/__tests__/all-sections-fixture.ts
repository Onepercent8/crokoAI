/**
 * A ContentDoc raw input exercising all 17 sections of the closed catalog.
 * Template placeholders only (Acme / example.com / curso-exemplo) — never real brands.
 * Used by the React render tests to cover every section component.
 */
export function allSectionsRawDoc() {
  return {
    settings: {
      locale: 'pt' as const,
      title: 'Curso Exemplo — Acme',
      metaDescription: 'Landing de demonstração do curso-exemplo da Acme.',
      noindex: true,
      checkoutUrl: 'https://checkout.example.com/curso-exemplo',
      priceCents: 19700,
    },
    theme: {
      palette: {
        primary: '#0a6e75',
        secondary: '#c1e1c2',
        background: '#1c1c1c',
        foreground: '#e1e1e1',
        accent: '#57cc99',
      },
      typography: { headingFont: 'Clash Display', bodyFont: 'Satoshi' },
      radius: 'lg' as const,
      shadow: 'md' as const,
    },
    sections: [
      {
        type: 'hero',
        position: 0,
        fields: {
          eyebrow: 'Novo',
          headline: 'Transforme sua carreira',
          subheadline: 'Com o curso-exemplo da Acme.',
          primaryCta: { label: 'Quero entrar', href: 'https://checkout.example.com/curso-exemplo' },
          secondaryCta: { label: 'Saber mais', href: 'https://example.com/sobre' },
          imageUrl: 'https://cdn.example.com/hero.png',
        },
      },
      {
        type: 'logo_cloud',
        position: 1,
        fields: {
          title: 'Empresas que confiam',
          logos: [{ alt: 'Acme', imageUrl: 'https://cdn.example.com/logo.png' }],
        },
      },
      {
        type: 'benefits',
        position: 2,
        fields: {
          title: 'Benefícios',
          subtitle: 'O que você ganha',
          items: [{ title: 'Acesso vitalício', description: 'Para sempre.', icon: '∞' }],
        },
      },
      {
        type: 'features',
        position: 3,
        fields: {
          title: 'Recursos',
          items: [
            {
              title: 'Aulas práticas',
              description: 'Mão na massa.',
              imageUrl: 'https://cdn.example.com/f.png',
            },
          ],
        },
      },
      {
        type: 'how_it_works',
        position: 4,
        fields: {
          title: 'Como funciona',
          steps: [
            { step: 2, title: 'Estude', description: 'No seu ritmo.' },
            { step: 1, title: 'Inscreva-se', description: 'É rápido.' },
          ],
        },
      },
      {
        type: 'social_proof',
        position: 5,
        fields: {
          quote: 'Mudou minha vida.',
          author: 'Aluno Exemplo',
          role: 'Cliente',
          avatarUrl: 'https://cdn.example.com/a.png',
        },
      },
      {
        type: 'testimonials',
        position: 6,
        fields: {
          title: 'Depoimentos',
          items: [{ quote: 'Excelente.', author: 'Outro Aluno', rating: 5 }],
        },
      },
      {
        type: 'stats',
        position: 7,
        fields: { title: 'Números', items: [{ value: '46x', label: 'ROI médio' }] },
      },
      {
        type: 'pricing',
        position: 8,
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
      {
        type: 'offer',
        position: 9,
        fields: {
          title: 'Oferta',
          description: 'Por tempo limitado.',
          priceCents: 19700,
          compareAtPriceCents: 29700,
          cta: { label: 'Aproveitar', href: 'https://checkout.example.com/curso-exemplo' },
          deadline: '2026-12-31T23:59:59.000Z',
        },
      },
      {
        type: 'guarantee',
        position: 10,
        fields: {
          title: 'Garantia',
          description: 'Risco zero.',
          days: 7,
          badgeUrl: 'https://cdn.example.com/badge.png',
        },
      },
      {
        type: 'faq',
        position: 11,
        fields: {
          title: 'Perguntas frequentes',
          items: [{ question: 'Tem garantia?', answer: 'Sim, 7 dias.' }],
        },
      },
      {
        type: 'about',
        position: 12,
        fields: {
          title: 'Sobre a Acme',
          body: 'Somos a Acme.',
          imageUrl: 'https://cdn.example.com/about.png',
        },
      },
      {
        type: 'lead_form',
        position: 13,
        fields: {
          title: 'Fale conosco',
          subtitle: 'Deixe seu contato',
          submitLabel: 'Enviar',
          action: 'https://example.com/lead',
          fields: [
            { name: 'name', label: 'Nome', type: 'text', required: true },
            { name: 'email', label: 'E-mail', type: 'email', required: true },
            { name: 'message', label: 'Mensagem', type: 'textarea', required: false },
          ],
          consentText: 'Aceito os termos.',
        },
      },
      {
        type: 'cta',
        position: 14,
        fields: {
          title: 'Pronto para começar?',
          subtitle: 'Entre agora.',
          cta: { label: 'Começar', href: 'https://checkout.example.com/curso-exemplo' },
        },
      },
      {
        type: 'video',
        position: 15,
        fields: {
          title: 'Veja como é',
          videoUrl: 'https://www.youtube.com/embed/example',
          caption: 'Demonstração',
        },
      },
      {
        type: 'footer',
        position: 16,
        fields: {
          companyName: 'Acme',
          tagline: 'Educação que transforma.',
          links: [{ label: 'Termos', href: 'https://example.com/termos' }],
          legalText: '© Acme. Todos os direitos reservados.',
        },
      },
    ],
  };
}
