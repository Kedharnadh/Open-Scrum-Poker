# Scrum Poker – Low Level Architecture Guide

> Version: 1.0  
> Target: Production-ready Progressive Web App (PWA)

## 1. Project Goals

- Progressive Web App (desktop/mobile installable)
- Anonymous, frictionless collaboration
- Real-time voting
- Multiple estimation scales
- Multiple themes and card styles
- High performance and accessibility
- Cloud-native, serverless architecture

---

# 2. High-Level Architecture

```text
                    Internet
                         │
          ┌──────────────┴──────────────┐
          │                             │
    Desktop PWA                  Mobile PWA
          │                             │
          └──────────────┬──────────────┘
                         │
                 Cloudflare Pages/CDN
                         │
                 React + Vite + PWA
                         │
        ┌────────────────┴────────────────┐
        │                                 │
  Anonymous Auth                  Supabase Realtime
        │                                 │
        └────────────────┬────────────────┘
                         │
                  PostgreSQL Database
                         │
              Storage / Edge Functions
```

---

# 3. Technology Stack

| Layer | Technology |
|--------|------------|
| UI | React 19 |
| Language | TypeScript |
| Build | Vite |
| UI Components | Material UI |
| Animation | Framer Motion |
| State | Zustand |
| Forms | React Hook Form |
| Validation | Zod |
| Routing | React Router |
| Backend | Supabase |
| Database | PostgreSQL |
| Realtime | Supabase Realtime |
| Hosting | Cloudflare Pages |
| Authentication | Anonymous Auth |
| Testing | Vitest + React Testing Library + Playwright |

---

# 4. Folder Structure

```text
scrum-poker/
├── .github/
├── docs/
├── public/
├── src/
│   ├── app/
│   ├── assets/
│   ├── components/
│   │   ├── cards/
│   │   ├── dialogs/
│   │   ├── room/
│   │   ├── settings/
│   │   ├── statistics/
│   │   └── common/
│   ├── hooks/
│   ├── pages/
│   ├── services/
│   ├── stores/
│   ├── themes/
│   ├── types/
│   ├── utils/
│   └── main.tsx
├── supabase/
└── README.md
```

---

# 5. Core Modules

- Authentication
- Room Management
- Presence Service
- Voting Engine
- Statistics Engine
- Theme Engine
- Scale Manager
- Preferences
- Notifications
- PWA Manager

---

# 6. Database Model

## rooms

- id (UUID)
- room_code
- room_name
- host_id
- active_scale
- card_theme
- theme
- locked
- created_at
- updated_at
- expires_at

## users

- id
- display_name
- avatar_color
- created_at

## room_members

- room_id
- user_id
- role (Host / Participant / Spectator)
- joined_at
- last_seen
- is_online

## votes

- room_id
- user_id
- value
- revealed
- created_at

## scales

- id
- owner
- name
- values (JSON Array)

---

# 7. Room Lifecycle

1. Host creates room.
2. Random room code generated.
3. Invite link shared.
4. Members join.
5. Voting begins.
6. Host reveals votes.
7. Statistics calculated.
8. Votes cleared.
9. Repeat until session ends.
10. Room expires after inactivity.

---

# 8. User Roles

## Host

- Reveal votes
- Hide votes
- Reset votes
- Kick members
- Transfer host
- Lock room
- Delete room

## Participant

- Vote
- Change vote
- Become spectator

## Spectator

- Observe only
- Switch to participant

---

# 9. Supported Estimation Scales

- Fibonacci
- Modified Fibonacci
- Linear (1–8 + ?)
- Powers of Two
- T-Shirt Sizes
- Days
- Hours
- Coffee
- Custom Scales

---

# 10. Themes

- System
- Light
- Dark
- Material Light
- Material Dark
- OLED Black
- High Contrast

---

# 11. Card Styles

- Classic Poker
- Material
- Glass
- Flat
- Neon
- Sketch

---

# 12. Statistics

- Average
- Median
- Min / Max
- Vote Distribution
- Standard Deviation
- Consensus Detection

---

# 13. Additional Enhancements

## Collaboration

- QR code invites
- Copy link
- Live presence
- Auto reconnect
- Host migration
- Room locking

## UX

- Confetti for unanimous votes
- Emoji reactions
- Keyboard shortcuts
- Timer
- Sound effects
- Responsive layout

## Preferences

- Remember display name
- Remember theme
- Remember preferred scale
- Remember card style

## Accessibility

- Keyboard navigation
- Screen reader support
- Reduced motion
- Large cards
- High contrast

---

# 14. Security

- Anonymous authentication
- Row Level Security
- Input validation
- Rate limiting
- Sanitized inputs

---

# 15. Performance

- Lazy loading
- Code splitting
- Tree shaking
- Memoization
- Optimized realtime subscriptions

---

# 16. PWA Features

- Installable
- Offline shell
- Update notifications
- App shortcuts
- Background sync

---

# 17. Future Roadmap

## Phase 1
- MVP
- Create/join room
- Voting
- Reveal
- PWA

## Phase 2
- Themes
- Card styles
- Custom scales
- Statistics
- QR codes

## Phase 3
- Timer
- Emoji reactions
- Localization
- Accessibility

## Phase 4
- Jira integration
- Azure DevOps
- GitHub Projects
- Slack
- Microsoft Teams

---

# 18. Testing Strategy

- Unit tests
- Component tests
- Integration tests
- End-to-end tests
- GitHub Actions CI/CD

---

# 19. Success Criteria

- Responsive on desktop, tablet and mobile
- Installable as a native-like app
- <100 ms realtime updates
- Anonymous onboarding in under 10 seconds
- Easily extensible architecture
