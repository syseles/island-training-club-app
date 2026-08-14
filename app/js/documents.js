// Single source of truth for every read-and-accept document body.
// The Profile > Indemnity inline card and the read-and-accept modal both
// render from this registry, so the page and the modal never drift.
//
// All copy is draft — pending ITC leadership review before launch.

export const DOCUMENTS = {
  indemnity: {
    title: "Health & Liability Indemnity",
    renderBody: renderIndemnityDocument,
  },
  privacy: {
    title: "Privacy Policy",
    renderBody: renderPrivacyDocument,
  },
  guidelines: {
    title: "Community Guidelines",
    renderBody: renderGuidelinesDocument,
  },
};

export function renderIndemnityDocument() {
  return `
    <div class="doc-content">
      <h3>Health declaration</h3>
      <p>I confirm that I am physically fit and in good health, and I know of no medical reason I should not take part in Island Training Club (ITC) activities. If my health changes, I will seek professional medical advice before taking part again.</p>
      <h3>Participation at my own risk</h3>
      <p>I understand that ITC activities are recreational, may be volunteer-led, and involve inherent physical risk. I take part at my own risk, will work within my own limits, and will follow the instructions of ITC leaders at all times.</p>
      <h3>Release &amp; indemnity</h3>
      <p>To the fullest extent permitted by law, I release and indemnify ITC, its leaders, members and volunteers against any claim, loss, injury or damage arising from my participation in ITC activities.</p>
      <h3>Emergency contact</h3>
      <p>I confirm the emergency contact details in my membership application are accurate, and I will keep them up to date.</p>
    </div>`;
}

export function renderPrivacyDocument() {
  return `
    <div class="doc-content">
      <h3>What we collect</h3>
      <p>When you apply to join Island Training Club (ITC), we collect your name, email, mobile or WhatsApp number, emergency contact details, and your photo/video consent preference. We keep your bookings and payment receipts while you are a member.</p>
      <h3>Why we collect it</h3>
      <p>We use this information to review your application, contact you about sessions and schedule changes, reach your emergency contact if something happens, and manage your bookings and receipts.</p>
      <h3>Who sees it</h3>
      <p>Only ITC leaders and the systems that run the club. We never sell your information or share it with third parties for marketing.</p>
      <h3>Your choices</h3>
      <p>Photo and video consent is optional and can be changed at any time from your Profile. You can ask an ITC leader to correct or delete your information. Questions? Speak to any ITC leader before or after a session.</p>
    </div>`;
}

export function renderGuidelinesDocument() {
  return `
    <div class="doc-content">
      <h3>Everyone is welcome</h3>
      <p>ITC is open to every fitness level and every background. There are no tryouts and no prerequisites — approval never depends on fitness level.</p>
      <h3>Respect and encouragement</h3>
      <p>We train together as a community. Encourage the person next to you, welcome newcomers, and treat every member, leader and volunteer with respect. Harassment, discrimination and bullying have no place at ITC.</p>
      <h3>Safety first</h3>
      <p>Follow the instructions of ITC leaders at all times. Work within your own limits, scale movements when asked, and tell a leader about any injury or health concern before a session starts.</p>
      <h3>Photos and media</h3>
      <p>We sometimes take photos and videos at sessions. You will only appear if you have given consent, and you can withdraw that consent at any time from your Profile.</p>
      <h3>Conduct</h3>
      <p>Members who repeatedly ignore these guidelines may be asked to leave a session, or have their membership reviewed by ITC leaders.</p>
    </div>`;
}
