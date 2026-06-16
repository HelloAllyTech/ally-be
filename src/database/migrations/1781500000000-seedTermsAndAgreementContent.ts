import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the sign-in "Terms & Agreement" consent text into `global_settings`
 * (key LEGAL_TERMS_AND_AGREEMENT) so the post-login consent popup renders the
 * existing copy out of the box. Admins can then edit it via /v1/settings.
 *
 * Idempotent: ON CONFLICT DO NOTHING so it never overwrites admin edits on
 * re-run. Terms of Service / Privacy Policy rows are created lazily on first
 * admin save (getLegalContent returns an empty string until then).
 */
export class SeedTermsAndAgreementContent1781500000000
  implements MigrationInterface
{
  name = 'SeedTermsAndAgreementContent1781500000000';

  private readonly html = `<h3>General Terms (All Users)</h3>
<ul>
<li>You are 18+ and legally able to enter contracts</li>
<li>You are accessing Ally through a partner organization formally engaged with Ally or through direct invitation by Ally for demonstration, testing or research purposes.</li>
<li>You are using Ally&rsquo;s platform in accordance with your affiliated organization&rsquo;s rules, ethics and requirements.</li>
<li>You understand that Ally is NOT for real emergencies. Contact crisis services, if needed. More information: <a href="https://findahelpline.com/" target="_blank" rel="noopener noreferrer">https://findahelpline.com/</a></li>
</ul>
<h3>For Ally Skills Lab (Training Simulations)</h3>
<ul>
<li>You understand that all the scenarios are fictional, and for training purposes only.</li>
<li>You understand that this doesn&rsquo;t replace human-supervised training, provide certification, or qualify you for independent practice.</li>
<li>You consent to audio and transcripts of role-play sessions being stored for quality improvement and being shared with your training organization/supervisor.</li>
</ul>
<h3>For Ally Assist (Session Notes)</h3>
<ul>
<li>You will use this only for authorized sessions per your organization&rsquo;s rules</li>
<li>For this product, <strong>audio recordings are NOT stored by Ally</strong>. Transcripts of sessions are stored and deleted based on the user organization&rsquo;s decision</li>
</ul>`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "global_settings" ("name", "value", "createdBy", "updatedBy")
       VALUES ($1, $2::jsonb, 0, 0)
       ON CONFLICT ("name") DO NOTHING`,
      ['LEGAL_TERMS_AND_AGREEMENT', JSON.stringify({ html: this.html })],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "global_settings" WHERE "name" = $1`,
      ['LEGAL_TERMS_AND_AGREEMENT'],
    );
  }
}
