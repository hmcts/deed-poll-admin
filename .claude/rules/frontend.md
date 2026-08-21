---
paths: [apps/web/src/pages/**/*.ts, apps/web/src/pages/**/*.njk, apps/web/**/*.ts]
---

# Frontend Development Rules

## Patterns Index

Patterns are best practice design solutions for specific user-focused tasks.

### Ask Users For...

| Pattern | Summary | Documentation |
|---------|---------|---------------|
| Addresses | Use multiple text inputs when you know which countries addresses come from; use address lookup for UK addresses; use textarea for broad address formats | [Link](https://design-system.service.gov.uk/patterns/addresses/) |
| Bank details | Use when you need users to provide bank details so you can pay them | [Link](https://design-system.service.gov.uk/patterns/bank-details/) |
| Dates | Use whenever you need users to provide or select a date | [Link](https://design-system.service.gov.uk/patterns/dates/) |
| Email addresses | Use whenever you need to capture an email address | [Link](https://design-system.service.gov.uk/patterns/email-addresses/) |
| Equality information | Use to collect equality data consistently using Government Statistical Service harmonised standards | [Link](https://design-system.service.gov.uk/patterns/equality-information/) |
| Names | Use whenever you need to ask for a user's name as part of your service | [Link](https://design-system.service.gov.uk/patterns/names/) |
| National Insurance numbers | Use whenever you need to ask for a National Insurance number | [Link](https://design-system.service.gov.uk/patterns/national-insurance-numbers/) |
| Passwords | Use whenever you need users to create or enter a password | [Link](https://design-system.service.gov.uk/patterns/passwords/) |
| Payment card details | Use if you cannot use GOV.UK Pay and need to build your own payment service | [Link](https://design-system.service.gov.uk/patterns/payment-card-details/) |
| Phone numbers | Use only if you genuinely need them; give users a choice about how they can be contacted | [Link](https://design-system.service.gov.uk/patterns/phone-numbers/) |

### Help Users To...

| Pattern | Summary | Documentation |
|---------|---------|---------------|
| Check a service is suitable | Use when your service has complicated eligibility requirements to help users determine if they're eligible | [Link](https://design-system.service.gov.uk/patterns/check-a-service-is-suitable/) |
| Check answers | Use to let users review their information before submission; show immediately before confirmation screen | [Link](https://design-system.service.gov.uk/patterns/check-answers/) |
| Complete multiple tasks | Use only for longer transactions involving multiple tasks that users may need to complete over multiple sessions | [Link](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/) |
| Confirm a phone number | Use when users need to sign in or complete higher-risk tasks like changing a password | [Link](https://design-system.service.gov.uk/patterns/confirm-a-phone-number/) |
| Confirm an email address | Use only when critical functionality requires email, or wrong email would give someone else access to sensitive information | [Link](https://design-system.service.gov.uk/patterns/confirm-an-email-address/) |
| Contact a department or service team | Use whenever you need to help users contact your team or department | [Link](https://design-system.service.gov.uk/patterns/contact-a-department-or-service-team/) |
| Create a username | Use only if you really need users to create accounts; consider if accounts are necessary first | [Link](https://design-system.service.gov.uk/patterns/create-a-username/) |
| Create accounts | Use if users need to regularly access or update their data in your service | [Link](https://design-system.service.gov.uk/patterns/create-accounts/) |
| Exit a page quickly | Use when your service contains sensitive information that could put someone at risk of abuse or retaliation | [Link](https://design-system.service.gov.uk/patterns/exit-a-page-quickly/) |
| Navigate a service | Use for services that are used repeatedly, involve multiple tasks, or don't have a clear linear journey | [Link](https://design-system.service.gov.uk/patterns/navigate-a-service/) |
| Start using a service | Use to prototype a start point for your service; public services must begin on a GOV.UK content page | [Link](https://design-system.service.gov.uk/patterns/start-using-a-service/) |
| Validation | Use to identify when users provide unusable information and display error messages to help them correct it | [Link](https://design-system.service.gov.uk/patterns/validation/) |

### Pages

| Pattern | Summary | Documentation |
|---------|---------|---------------|
| Confirmation pages | Use at the end of a transaction | [Link](https://design-system.service.gov.uk/patterns/confirmation-pages/) |
| Cookies page | Use to tell users about cookies or similar technologies that store information on their device | [Link](https://design-system.service.gov.uk/patterns/cookies-page/) |
| Page not found pages | Use when someone is trying to view a page that does not exist | [Link](https://design-system.service.gov.uk/patterns/page-not-found-pages/) |
| Problem with the service pages | Use when there is an unexpected problem with the service; log errors to fix them quickly | [Link](https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/) |
| Question pages | Use whenever you need to ask users questions within your service | [Link](https://design-system.service.gov.uk/patterns/question-pages/) |
| Service unavailable pages | Use when a service has been closed on purpose, either temporarily or permanently | [Link](https://design-system.service.gov.uk/patterns/service-unavailable-pages/) |
| Step by step navigation | Use for journeys with a specific start and end point that require users to interact with multiple pieces of guidance or transactions | [Link](https://design-system.service.gov.uk/patterns/step-by-step-navigation/) |

---

## Components Index

Components are reusable parts of the user interface.

| Component | Summary | Documentation |
|-----------|---------|---------------|
| Accordion | Use when users need to see an overview of related sections and choose which to show/hide | [Link](https://design-system.service.gov.uk/components/accordion/) |
| Back link | Always include on GOV.UK question pages; can include on other pages in multi-page transactions | [Link](https://design-system.service.gov.uk/components/back-link/) |
| Breadcrumbs | Use to help users understand and move between multiple levels of a website | [Link](https://design-system.service.gov.uk/components/breadcrumbs/) |
| Button | Use to help users carry out an action like starting an application or saving information | [Link](https://design-system.service.gov.uk/components/button/) |
| Character count | Use when there's a valid reason to limit character input due to user behavior or technical constraints | [Link](https://design-system.service.gov.uk/components/character-count/) |
| Checkboxes | Use when users need to select multiple options from a list or toggle a single option on/off | [Link](https://design-system.service.gov.uk/components/checkboxes/) |
| Cookie banner | Use if your service sets any cookies on user devices | [Link](https://design-system.service.gov.uk/components/cookie-banner/) |
| Date input | Use when asking users for a date they already know or can look up without a calendar | [Link](https://design-system.service.gov.uk/components/date-input/) |
| Details | Use to make a page easier to scan when it contains information only some users need | [Link](https://design-system.service.gov.uk/components/details/) |
| Error message | Show next to the field and in the error summary when there is a validation error | [Link](https://design-system.service.gov.uk/components/error-message/) |
| Error summary | Always show when there is a validation error, even if there's only one | [Link](https://design-system.service.gov.uk/components/error-summary/) |
| Exit this page | Use on pages with sensitive information that could put someone at risk of abuse | [Link](https://design-system.service.gov.uk/components/exit-this-page/) |
| Fieldset | Use to show a relationship between multiple form inputs, e.g. grouping address fields | [Link](https://design-system.service.gov.uk/components/fieldset/) |
| File upload | Use only if uploading files is critical to the delivery of your service | [Link](https://design-system.service.gov.uk/components/file-upload/) |
| Footer | Use at the bottom of every page of your service | [Link](https://design-system.service.gov.uk/components/footer/) |
| Header | Must use at the top of every page for services on gov.uk domains | [Link](https://design-system.service.gov.uk/components/header/) |
| Inset text | Use to differentiate a block of text for quotes, examples, or additional information | [Link](https://design-system.service.gov.uk/components/inset-text/) |
| Notification banner | Use for information not directly tied to page content, like service-wide issues or action confirmations | [Link](https://design-system.service.gov.uk/components/notification-banner/) |
| Pagination | Use when showing all content on one page makes it too slow, or most users only need first few pages | [Link](https://design-system.service.gov.uk/components/pagination/) |
| Panel | Use to display important information when a transaction has been completed | [Link](https://design-system.service.gov.uk/components/panel/) |
| Password input | Use whenever you need users to create or enter a password | [Link](https://design-system.service.gov.uk/components/password-input/) |
| Phase banner | Must use on service.gov.uk domains until passing a live assessment | [Link](https://design-system.service.gov.uk/components/phase-banner/) |
| Radios | Use when users can only select one option from a list | [Link](https://design-system.service.gov.uk/components/radios/) |
| Select | Use only as a last resort; research shows some users find selects very difficult to use | [Link](https://design-system.service.gov.uk/components/select/) |
| Service navigation | Use to help users understand they're using your service and navigate around it | [Link](https://design-system.service.gov.uk/components/service-navigation/) |
| Skip link | All GOV.UK pages must include; position after opening body tag or after cookie banner | [Link](https://design-system.service.gov.uk/components/skip-link/) |
| Summary list | Use to show information as a list of key facts, like metadata or form response summaries | [Link](https://design-system.service.gov.uk/components/summary-list/) |
| Table | Use to let users compare information in rows and columns | [Link](https://design-system.service.gov.uk/components/table/) |
| Tabs | Use when content can be separated into clearly labelled sections and users don't need to view all at once | [Link](https://design-system.service.gov.uk/components/tabs/) |
| Tag | Use when something can have multiple statuses and it's useful for users to know the status | [Link](https://design-system.service.gov.uk/components/tag/) |
| Task list | Use for long, complex services where users cannot complete all tasks in one session | [Link](https://design-system.service.gov.uk/components/task-list/) |
| Text input | Use when users need to enter text no longer than a single line | [Link](https://design-system.service.gov.uk/components/text-input/) |
| Textarea | Use when users need to enter text longer than a single line | [Link](https://design-system.service.gov.uk/components/textarea/) |
| Warning text | Use to warn users about something important, such as legal consequences of an action | [Link](https://design-system.service.gov.uk/components/warning-text/) |

## Page Controller Pattern

Controllers live in `apps/web/src/pages/` with `GET` and `POST` exports. Routes are auto-generated from file names.

### Controller Structure

```typescript
// apps/web/src/pages/[feature]/[page-name].ts
import type { Request, Response } from "express";

const en = {
  title: "Page Title",
  // Page-specific content only
};

const cy = {
  title: "Teitl y Dudalen",
  // Welsh translation with identical structure
};

export const GET = async (_req: Request, res: Response) => {
  res.render("page-name", { en, cy });
};

export const POST = async (req: Request, res: Response) => {
  // Validate → Service call → Redirect or Re-render with errors
};
```

### Controller Rules

- **No business logic in controllers** - delegate to service functions
- **Always provide both `en` and `cy`** - every page must support Welsh
- **Preserve user data on errors** - pass `data: req.body` back to template
- **Use redirects after successful POST** - prevent duplicate submissions
- **Template name must match file name** - `my-page.ts` renders `my-page.njk`

## Nunjucks Template Pattern

### Template Structure

```njk
{% extends "layouts/default.njk" %}
{% from "govuk/components/button/macro.njk" import govukButton %}
{% from "govuk/components/input/macro.njk" import govukInput %}
{% from "govuk/components/error-summary/macro.njk" import govukErrorSummary %}

{% block page_content %}
<div class="govuk-grid-row">
  <div class="govuk-grid-column-two-thirds">

    {% if errors %}
      {{ govukErrorSummary({
        titleText: errorSummaryTitle,
        errorList: errors
      }) }}
    {% endif %}

    <h1 class="govuk-heading-xl">{{ title }}</h1>

    <form method="post" novalidate>
      {{ govukInput({
        id: "email",
        name: "email",
        type: "email",
        autocomplete: "email",
        label: { text: emailLabel },
        errorMessage: errors.email,
        value: data.email
      }) }}

      {{ govukButton({ text: continueButtonText }) }}
    </form>

  </div>
</div>
{% endblock %}
```

### Template Rules

- **Use `page_content` block** - not `content` (layout-specific)
- **Import macros at top** - use `{% from %}` for GOV.UK components
- **Error summary before h1** - when validation errors exist
- **Add `novalidate` to forms** - server-side validation handles all cases
- **Use `autocomplete` attributes** - for all personal data inputs
- **Never use inline styles** - use GOV.UK classes only

## Bilingual Content

### Content Location

| Content Type | Location |
|--------------|----------|
| Page titles, headings, body text | Controller `en`/`cy` objects |
| Shared buttons, labels, errors | `libs/[module]/src/locales/en.ts` and `cy.ts` |

### Welsh Translation Rules

- **Identical structure** - `cy` object must mirror `en` exactly
- **Test with `?lng=cy`** - verify all text translates correctly
- **No hardcoded English** - all visible text must come from content objects

### Interpolating dynamic values

When content needs to reference runtime values, make the `en`/`cy` entry a function. It receives the rest of the view model as its context, so you interpolate with plain template literals — no separate templating layer, and the values stay type-checked:

```typescript
const en = (m: { firstName: string }) => ({
  title: `Check your answers, ${m.firstName}`
});
const cy = (m: { firstName: string }) => ({
  title: `Gwiriwch eich atebion, ${m.firstName}`
});

export const GET = async (req: Request, res: Response) => {
  res.render("page-name", { en, cy, firstName: applicant.firstName });
};
```

Object and function entries can be mixed; keep static pages as plain objects. Zod error messages follow the same pattern — pass the resolved (interpolated) messages into a schema factory per request, e.g. `schema((res.locals.locale === "cy" ? cy : en)({ maxLen: 100 }).errors)`. Do **not** register a global `z.setErrorMap` for localisation — it mutates process-wide state and cannot be scoped per request.

## Form Handling

### Error Display Pattern

```typescript
export const POST = async (req: Request, res: Response) => {
  const errors = validateForm(req.body);

  if (errors.length > 0) {
    return res.render("form-page", {
      en, cy,
      errors,
      data: req.body // Preserve user input
    });
  }

  await myService.process(req.body);
  res.redirect("/success");
};
```

### Error Message Format

```typescript
// Error summary format (array)
const errors = [
  { text: "Enter your email address", href: "#email" }
];

// Field error format (object keyed by field)
const fieldErrors = {
  email: { text: "Enter a valid email address" }
};
```

### Validation Rules

- **Server-side only** - no client-side validation as primary mechanism
- **Specific messages** - "Enter your email" not "This field is required"
- **Include format hints** - "Enter a date like 31 3 1980"
- **Link to field** - `href: "#field-id"` in error summary

## GOV.UK Component Usage

### Input Components

```njk
{# Text input #}
{{ govukInput({
  id: "name",
  name: "name",
  label: { text: nameLabel, isPageHeading: true, classes: "govuk-label--l" },
  value: data.name,
  errorMessage: errors.name
}) }}

{# Email with autocomplete #}
{{ govukInput({
  id: "email",
  name: "email",
  type: "email",
  autocomplete: "email",
  spellcheck: false,
  label: { text: emailLabel },
  value: data.email,
  errorMessage: errors.email
}) }}
```

### Selection Components

```njk
{# Radios - single selection #}
{{ govukRadios({
  name: "contact-preference",
  fieldset: { legend: { text: contactPreferenceLabel, isPageHeading: true, classes: "govuk-fieldset__legend--l" } },
  items: [
    { value: "email", text: emailOptionText },
    { value: "phone", text: phoneOptionText }
  ],
  errorMessage: errors["contact-preference"]
}) }}

{# Checkboxes - multiple selection #}
{{ govukCheckboxes({
  name: "notifications",
  fieldset: { legend: { text: notificationsLabel } },
  items: notificationItems,
  errorMessage: errors.notifications
}) }}
```

### Date Input

```njk
{{ govukDateInput({
  id: "date-of-birth",
  namePrefix: "date-of-birth",
  fieldset: { legend: { text: dateOfBirthLabel, isPageHeading: true, classes: "govuk-fieldset__legend--l" } },
  hint: { text: dateHintText },
  items: [
    { name: "day", classes: "govuk-input--width-2", value: data["date-of-birth-day"] },
    { name: "month", classes: "govuk-input--width-2", value: data["date-of-birth-month"] },
    { name: "year", classes: "govuk-input--width-4", value: data["date-of-birth-year"] }
  ],
  errorMessage: errors["date-of-birth"]
}) }}
```

## Accessibility Requirements

### Mandatory Checklist

- [ ] Page title matches h1
- [ ] Heading hierarchy logical (h1 → h2 → h3)
- [ ] All form inputs have labels
- [ ] Error summary links to fields
- [ ] Color is not sole information carrier
- [ ] Focus states visible on all interactive elements

### Keyboard Navigation

- All interactive elements must be keyboard accessible
- Tab order follows visual reading order
- No keyboard traps
- Form submission via Enter key works

### Screen Reader Support

- Use semantic HTML elements
- Provide `aria-describedby` for hint text connections
- Error messages announced with `aria-invalid="true"`

## CSS and Styling

### Use GOV.UK Classes Only

```njk
{# Correct - using GOV.UK typography classes #}
<p class="govuk-body">Paragraph text</p>
<p class="govuk-body-l">Large paragraph</p>
<h2 class="govuk-heading-m">Medium heading</h2>

{# Correct - using GOV.UK spacing #}
<div class="govuk-!-margin-bottom-6">Content</div>

{# Wrong - custom styles #}
<p style="font-size: 18px;">Text</p>
```

### Custom Styles (When Necessary)

```scss
// Use BEM naming with app- prefix
.app-custom-component { }
.app-custom-component__element { }
.app-custom-component--modifier { }

// Use GOV.UK variables
@import "govuk-frontend/govuk/all";

.app-custom {
  @include govuk-font($size: 19);
  @include govuk-responsive-margin(6, "bottom");
  color: govuk-colour("blue");
}
```

## Progressive Enhancement

- Core functionality must work without JavaScript
- Use native HTML form elements
- JS enhances but doesn't replace functionality
- No JS frameworks - vanilla JavaScript only

## Session Data

### Namespaced Storage

```typescript
interface MyModuleSession extends Session {
  myModule?: {
    formData?: FormData;
    currentStep?: string;
  };
}

// Access in controller
const sessionData = (req.session as MyModuleSession).myModule;
```

## File Organization

```
apps/web/src/pages/[feature]/
├── form-step-one.ts       # Controller
├── form-step-one.njk      # Template
├── form-step-one.test.ts  # Tests
├── form-step-two.ts
├── form-step-two.njk
└── (group)/               # Route group — dir stripped from URL
    ├── page.ts
    └── page.njk
```

## Anti-Patterns to Avoid

### Controller Anti-Patterns

- ❌ Business logic in controllers
- ❌ Missing Welsh translations
- ❌ Hardcoded strings in templates
- ❌ Not preserving form data on errors
- ❌ Multiple form fields asking different questions per page

### Template Anti-Patterns

- ❌ Inline styles
- ❌ Custom classes instead of GOV.UK classes
- ❌ Client-side validation as primary mechanism
- ❌ JavaScript-dependent core functionality
- ❌ Using `content` block instead of `page_content`

### Accessibility Anti-Patterns

- ❌ Missing form labels
- ❌ Error summary without field links
- ❌ Skipping heading levels
- ❌ Color-only information
- ❌ Non-keyboard-accessible elements
