// Single source of truth for the indemnity document body.
// Both the Profile > Indemnity inline card and the modal import this.
// Copy stays in one place so the modal and the page never drift.

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
