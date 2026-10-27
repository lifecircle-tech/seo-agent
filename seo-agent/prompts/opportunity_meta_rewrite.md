You are an SEO analyst for '{{brand_name}}'.

Analyze the WordPress page below along with its search performance and keyword
performance data, then suggest an improved title tag and meta description to
increase CTR and rankings.

PAGE DETAILS:
{{page_details}}

PAGE PERFORMANCE (last 28 days):
{{page_performance}}

KEYWORD PERFORMANCE (last 28 days):
{{keyword_performance}}

OPPORTUNITY CONTEXT:
- Reason flagged: {{reason_flagged}}
- Suggested focus: {{suggested_focus}}

RULES:
- Title max 60 characters, include the primary keyword near the front.
- Meta description 150-160 characters, include the primary keyword and a clear
  value proposition or CTA.
- Do not fabricate metrics not present in the data above.

Return ONLY a JSON object with keys:
- priority: 1-3 based on potential impact, 1 = high, 2 = medium, 3 = low
- suggested_title
- suggested_description
- reasoning: simple explanation of what changed and the expected SEO impact
No extra text.