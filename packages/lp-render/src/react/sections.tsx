import type { JSX } from 'react';
import { formatCentsBRL } from '../domain/serializer.js';
import type { SectionFields, SectionType } from '../domain/sections.js';

/**
 * React render components for the 17-section closed catalog (SPEC-011 / ADR 0013).
 *
 * Single source of truth for HOW each section renders. The `landing-pages/_template`
 * imports these and renders the serialized content-spec; the dashboard editor
 * (Onda 9) can reuse them for preview. One component per `SectionType`.
 *
 * Styling is driven entirely by CSS custom properties emitted in `theme.css`
 * (`--color-*`, `--font-*`, `--radius`, `--shadow`) so the same components render
 * the Croko default theme or any per-LP override without code changes.
 *
 * Content is DATA, not instruction: React escapes all text by default. No section
 * renders raw HTML from the model — the catalog is closed (no XSS surface).
 */

type SectionComponent<K extends SectionType> = (props: { fields: SectionFields[K] }) => JSX.Element;

const section = (id: string, children: JSX.Element | JSX.Element[]): JSX.Element => (
  <section className={`lp-section lp-section--${id}`} data-section={id}>
    <div className="lp-container">{children}</div>
  </section>
);

const priceLabel = (cents: number): string => `R$ ${formatCentsBRL(cents)}`;

const Hero: SectionComponent<'hero'> = ({ fields }) =>
  section('hero', [
    <div className="lp-hero" key="hero">
      {fields.eyebrow !== undefined ? <p className="lp-eyebrow">{fields.eyebrow}</p> : <></>}
      <h1 className="lp-headline">{fields.headline}</h1>
      {fields.subheadline !== undefined ? (
        <p className="lp-subheadline">{fields.subheadline}</p>
      ) : (
        <></>
      )}
      <div className="lp-cta-row">
        <a className="lp-btn lp-btn--primary" href={fields.primaryCta.href}>
          {fields.primaryCta.label}
        </a>
        {fields.secondaryCta !== undefined ? (
          <a className="lp-btn lp-btn--secondary" href={fields.secondaryCta.href}>
            {fields.secondaryCta.label}
          </a>
        ) : (
          <></>
        )}
      </div>
    </div>,
    fields.imageUrl !== undefined ? (
      <img className="lp-hero-image" src={fields.imageUrl} alt="" key="img" loading="lazy" />
    ) : (
      <span key="img" />
    ),
  ]);

const LogoCloud: SectionComponent<'logo_cloud'> = ({ fields }) =>
  section('logo_cloud', [
    fields.title !== undefined ? (
      <h2 className="lp-section-title" key="t">
        {fields.title}
      </h2>
    ) : (
      <span key="t" />
    ),
    <ul className="lp-logos" key="logos">
      {fields.logos.map((logo, i) => (
        <li key={i}>
          <img src={logo.imageUrl} alt={logo.alt} loading="lazy" />
        </li>
      ))}
    </ul>,
  ]);

const Benefits: SectionComponent<'benefits'> = ({ fields }) =>
  section('benefits', [
    <h2 className="lp-section-title" key="t">
      {fields.title}
    </h2>,
    fields.subtitle !== undefined ? (
      <p className="lp-section-subtitle" key="s">
        {fields.subtitle}
      </p>
    ) : (
      <span key="s" />
    ),
    <ul className="lp-grid lp-benefits" key="items">
      {fields.items.map((item, i) => (
        <li className="lp-card" key={i}>
          {item.icon !== undefined ? <span className="lp-icon">{item.icon}</span> : <></>}
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </li>
      ))}
    </ul>,
  ]);

const Features: SectionComponent<'features'> = ({ fields }) =>
  section('features', [
    <h2 className="lp-section-title" key="t">
      {fields.title}
    </h2>,
    fields.subtitle !== undefined ? (
      <p className="lp-section-subtitle" key="s">
        {fields.subtitle}
      </p>
    ) : (
      <span key="s" />
    ),
    <ul className="lp-grid lp-features" key="items">
      {fields.items.map((item, i) => (
        <li className="lp-card" key={i}>
          {item.imageUrl !== undefined ? <img src={item.imageUrl} alt="" loading="lazy" /> : <></>}
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </li>
      ))}
    </ul>,
  ]);

const HowItWorks: SectionComponent<'how_it_works'> = ({ fields }) =>
  section('how_it_works', [
    <h2 className="lp-section-title" key="t">
      {fields.title}
    </h2>,
    <ol className="lp-steps" key="steps">
      {[...fields.steps]
        .sort((a, b) => a.step - b.step)
        .map((s, i) => (
          <li className="lp-step" key={i}>
            <span className="lp-step-num">{s.step}</span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
            </div>
          </li>
        ))}
    </ol>,
  ]);

const SocialProof: SectionComponent<'social_proof'> = ({ fields }) =>
  section('social_proof', [
    fields.title !== undefined ? (
      <h2 className="lp-section-title" key="t">
        {fields.title}
      </h2>
    ) : (
      <span key="t" />
    ),
    <figure className="lp-quote" key="q">
      <blockquote>{fields.quote}</blockquote>
      <figcaption>
        {fields.avatarUrl !== undefined ? (
          <img src={fields.avatarUrl} alt="" loading="lazy" />
        ) : (
          <></>
        )}
        <span>
          <strong>{fields.author}</strong>
          {fields.role !== undefined ? <em>{fields.role}</em> : <></>}
        </span>
      </figcaption>
    </figure>,
  ]);

const Testimonials: SectionComponent<'testimonials'> = ({ fields }) =>
  section('testimonials', [
    <h2 className="lp-section-title" key="t">
      {fields.title}
    </h2>,
    <ul className="lp-grid lp-testimonials" key="items">
      {fields.items.map((item, i) => (
        <li className="lp-card lp-quote" key={i}>
          {item.rating !== undefined ? (
            <span className="lp-rating" aria-label={`${item.rating} de 5`}>
              {'★'.repeat(item.rating)}
            </span>
          ) : (
            <></>
          )}
          <blockquote>{item.quote}</blockquote>
          <figcaption>
            {item.avatarUrl !== undefined ? (
              <img src={item.avatarUrl} alt="" loading="lazy" />
            ) : (
              <></>
            )}
            <span>
              <strong>{item.author}</strong>
              {item.role !== undefined ? <em>{item.role}</em> : <></>}
            </span>
          </figcaption>
        </li>
      ))}
    </ul>,
  ]);

const Stats: SectionComponent<'stats'> = ({ fields }) =>
  section('stats', [
    fields.title !== undefined ? (
      <h2 className="lp-section-title" key="t">
        {fields.title}
      </h2>
    ) : (
      <span key="t" />
    ),
    <ul className="lp-stats" key="items">
      {fields.items.map((item, i) => (
        <li key={i}>
          <strong className="lp-stat-value">{item.value}</strong>
          <span className="lp-stat-label">{item.label}</span>
        </li>
      ))}
    </ul>,
  ]);

const Pricing: SectionComponent<'pricing'> = ({ fields }) =>
  section('pricing', [
    <h2 className="lp-section-title" key="t">
      {fields.title}
    </h2>,
    fields.subtitle !== undefined ? (
      <p className="lp-section-subtitle" key="s">
        {fields.subtitle}
      </p>
    ) : (
      <span key="s" />
    ),
    <ul className="lp-grid lp-pricing" key="plans">
      {fields.plans.map((plan, i) => (
        <li className={`lp-card lp-plan${plan.highlighted ? ' lp-plan--featured' : ''}`} key={i}>
          <h3>{plan.name}</h3>
          <p className="lp-price">
            {priceLabel(plan.priceCents)}
            {plan.period !== undefined ? <span className="lp-period">/{plan.period}</span> : <></>}
          </p>
          <ul className="lp-plan-features">
            {plan.features.map((f, j) => (
              <li key={j}>{f}</li>
            ))}
          </ul>
          <a className="lp-btn lp-btn--primary" href={plan.cta.href}>
            {plan.cta.label}
          </a>
        </li>
      ))}
    </ul>,
  ]);

const Offer: SectionComponent<'offer'> = ({ fields }) =>
  section('offer', [
    <div className="lp-offer" key="offer">
      <h2 className="lp-section-title">{fields.title}</h2>
      <p className="lp-section-subtitle">{fields.description}</p>
      <p className="lp-price">
        {fields.compareAtPriceCents !== undefined ? (
          <s className="lp-compare-price">{priceLabel(fields.compareAtPriceCents)}</s>
        ) : (
          <></>
        )}{' '}
        <strong>{priceLabel(fields.priceCents)}</strong>
      </p>
      {fields.deadline !== undefined ? (
        <p className="lp-deadline" data-deadline={fields.deadline}>
          Oferta por tempo limitado
        </p>
      ) : (
        <></>
      )}
      <a className="lp-btn lp-btn--primary" href={fields.cta.href}>
        {fields.cta.label}
      </a>
    </div>,
  ]);

const Guarantee: SectionComponent<'guarantee'> = ({ fields }) =>
  section('guarantee', [
    <div className="lp-guarantee" key="g">
      {fields.badgeUrl !== undefined ? (
        <img className="lp-badge" src={fields.badgeUrl} alt="" loading="lazy" />
      ) : (
        <></>
      )}
      <h2 className="lp-section-title">{fields.title}</h2>
      <p>{fields.description}</p>
      {fields.days !== undefined ? (
        <p className="lp-guarantee-days">{fields.days} dias de garantia</p>
      ) : (
        <></>
      )}
    </div>,
  ]);

const Faq: SectionComponent<'faq'> = ({ fields }) =>
  section('faq', [
    <h2 className="lp-section-title" key="t">
      {fields.title}
    </h2>,
    <div className="lp-faq" key="items">
      {fields.items.map((item, i) => (
        <details className="lp-faq-item" key={i}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>,
  ]);

const About: SectionComponent<'about'> = ({ fields }) =>
  section('about', [
    <div className="lp-about" key="a">
      <h2 className="lp-section-title">{fields.title}</h2>
      <p>{fields.body}</p>
    </div>,
    fields.imageUrl !== undefined ? (
      <img className="lp-about-image" src={fields.imageUrl} alt="" key="img" loading="lazy" />
    ) : (
      <span key="img" />
    ),
  ]);

const LeadForm: SectionComponent<'lead_form'> = ({ fields }) =>
  section('lead_form', [
    <div className="lp-lead-form" key="f">
      <h2 className="lp-section-title">{fields.title}</h2>
      {fields.subtitle !== undefined ? (
        <p className="lp-section-subtitle">{fields.subtitle}</p>
      ) : (
        <></>
      )}
      <form action={fields.action} method="post" className="lp-form">
        {fields.fields.map((f, i) =>
          f.type === 'textarea' ? (
            <label key={i}>
              <span>{f.label}</span>
              <textarea name={f.name} required={f.required} />
            </label>
          ) : (
            <label key={i}>
              <span>{f.label}</span>
              <input type={f.type} name={f.name} required={f.required} />
            </label>
          ),
        )}
        {fields.consentText !== undefined ? (
          <p className="lp-consent">{fields.consentText}</p>
        ) : (
          <></>
        )}
        <button type="submit" className="lp-btn lp-btn--primary">
          {fields.submitLabel}
        </button>
      </form>
    </div>,
  ]);

const Cta: SectionComponent<'cta'> = ({ fields }) =>
  section('cta', [
    <div className="lp-cta-block" key="c">
      <h2 className="lp-section-title">{fields.title}</h2>
      {fields.subtitle !== undefined ? (
        <p className="lp-section-subtitle">{fields.subtitle}</p>
      ) : (
        <></>
      )}
      <a className="lp-btn lp-btn--primary" href={fields.cta.href}>
        {fields.cta.label}
      </a>
    </div>,
  ]);

const Video: SectionComponent<'video'> = ({ fields }) =>
  section('video', [
    fields.title !== undefined ? (
      <h2 className="lp-section-title" key="t">
        {fields.title}
      </h2>
    ) : (
      <span key="t" />
    ),
    <div className="lp-video" key="v">
      <iframe
        src={fields.videoUrl}
        title={fields.title ?? 'video'}
        loading="lazy"
        allowFullScreen
      />
    </div>,
    fields.caption !== undefined ? (
      <p className="lp-video-caption" key="c">
        {fields.caption}
      </p>
    ) : (
      <span key="c" />
    ),
  ]);

const Footer: SectionComponent<'footer'> = ({ fields }) => (
  <footer className="lp-section lp-section--footer" data-section="footer">
    <div className="lp-container">
      <p className="lp-footer-company">{fields.companyName}</p>
      {fields.tagline !== undefined ? <p className="lp-footer-tagline">{fields.tagline}</p> : <></>}
      {fields.links.length > 0 ? (
        <ul className="lp-footer-links">
          {fields.links.map((link, i) => (
            <li key={i}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      ) : (
        <></>
      )}
      {fields.legalText !== undefined ? (
        <p className="lp-footer-legal">{fields.legalText}</p>
      ) : (
        <></>
      )}
    </div>
  </footer>
);

/** Map each section type to its render component (closed catalog). */
export const SECTION_COMPONENTS: { [K in SectionType]: SectionComponent<K> } = {
  hero: Hero,
  logo_cloud: LogoCloud,
  benefits: Benefits,
  features: Features,
  how_it_works: HowItWorks,
  social_proof: SocialProof,
  testimonials: Testimonials,
  stats: Stats,
  pricing: Pricing,
  offer: Offer,
  guarantee: Guarantee,
  faq: Faq,
  about: About,
  lead_form: LeadForm,
  cta: Cta,
  video: Video,
  footer: Footer,
};
