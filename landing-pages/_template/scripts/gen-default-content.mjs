/**
 * Generate the default sample content artifacts for the landing template.
 *
 * Runs the @template/lp-render serializer over a placeholder ContentDoc
 * (curso-exemplo / Acme / example.com) so the template builds standalone with a
 * valid, in-sync content-spec.json + messages/pt.json + theme.css. The publish
 * skill overwrites these per landing page; this is the demo default.
 *
 * Usage: node scripts/gen-default-content.mjs
 */
import { parseContentDoc, serialize } from '@template/lp-render';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contentDir = join(root, 'content');

const raw = {
  settings: {
    locale: 'pt',
    title: 'Curso Exemplo - Acme',
    metaDescription: 'A landing page de demonstracao do curso-exemplo da Acme.',
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
    radius: 'lg',
    shadow: 'md',
  },
  sections: [
    {
      type: 'hero',
      position: 0,
      fields: {
        eyebrow: 'Curso online',
        headline: 'Domine o assunto com o curso-exemplo',
        subheadline: 'O metodo da Acme para voce sair do zero ao avancado.',
        primaryCta: {
          label: 'Quero me inscrever',
          href: 'https://checkout.example.com/curso-exemplo',
        },
        secondaryCta: { label: 'Ver conteudo', href: 'https://example.com/curso-exemplo' },
      },
    },
    {
      type: 'benefits',
      position: 1,
      fields: {
        title: 'O que voce conquista',
        subtitle: 'Resultados concretos, no seu ritmo.',
        items: [
          { title: 'Acesso vitalicio', description: 'Estude quando e onde quiser.', icon: 'star' },
          {
            title: 'Suporte direto',
            description: 'Tire duvidas com a equipe da Acme.',
            icon: 'chat',
          },
          { title: 'Certificado', description: 'Comprove sua nova habilidade.', icon: 'cap' },
        ],
      },
    },
    {
      type: 'how_it_works',
      position: 2,
      fields: {
        title: 'Como funciona',
        steps: [
          { step: 1, title: 'Inscreva-se', description: 'Garanta sua vaga em minutos.' },
          { step: 2, title: 'Estude', description: 'Siga a trilha de aulas praticas.' },
          { step: 3, title: 'Aplique', description: 'Coloque em pratica e veja resultados.' },
        ],
      },
    },
    {
      type: 'testimonials',
      position: 3,
      fields: {
        title: 'Quem fez, recomenda',
        items: [
          {
            quote: 'O melhor investimento que fiz na minha carreira.',
            author: 'Aluno Exemplo',
            role: 'Profissional',
            rating: 5,
          },
        ],
      },
    },
    {
      type: 'pricing',
      position: 4,
      fields: {
        title: 'Escolha seu acesso',
        plans: [
          {
            name: 'Acesso completo',
            priceCents: 19700,
            period: 'unico',
            features: ['Todas as aulas', 'Acesso vitalicio', 'Certificado'],
            cta: { label: 'Comprar agora', href: 'https://checkout.example.com/curso-exemplo' },
            highlighted: true,
          },
        ],
      },
    },
    {
      type: 'guarantee',
      position: 5,
      fields: {
        title: 'Garantia de 7 dias',
        description: 'Nao gostou? Devolvemos 100% do valor, sem perguntas.',
        days: 7,
      },
    },
    {
      type: 'faq',
      position: 6,
      fields: {
        title: 'Perguntas frequentes',
        items: [
          { question: 'Por quanto tempo tenho acesso?', answer: 'O acesso e vitalicio.' },
          { question: 'Existe garantia?', answer: 'Sim, 7 dias de garantia incondicional.' },
        ],
      },
    },
    {
      type: 'cta',
      position: 7,
      fields: {
        title: 'Pronto para comecar?',
        subtitle: 'Junte-se aos alunos da Acme hoje.',
        cta: { label: 'Quero me inscrever', href: 'https://checkout.example.com/curso-exemplo' },
      },
    },
    {
      type: 'footer',
      position: 8,
      fields: {
        companyName: 'Acme',
        tagline: 'Educacao que transforma.',
        links: [
          { label: 'Termos', href: 'https://example.com/termos' },
          { label: 'Privacidade', href: 'https://example.com/privacidade' },
        ],
        legalText: 'Acme. Conteudo de demonstracao - placeholders do template.',
      },
    },
  ],
};

const doc = parseContentDoc(raw);
const artifacts = serialize(doc);
mkdirSync(join(contentDir, 'messages'), { recursive: true });
writeFileSync(join(contentDir, 'content-spec.json'), artifacts['content-spec.json']);
writeFileSync(join(contentDir, 'messages', 'pt.json'), artifacts['messages/pt.json']);
writeFileSync(join(contentDir, 'theme.css'), artifacts['theme.css']);
console.log('wrote default content artifacts to', contentDir);
