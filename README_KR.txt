
GN ROTATION CLOUD v4 CLEAN
===========================

목표
- 노트북 OFF 상태에서도 24시간 동작
- Render Cron: 15분마다 GN 계산
- Supabase Postgres: 상태/점수/OI/도미넌스/실행로그 영구 저장
- Render Web: 휴대폰 웹 대시보드
- Telegram/메신저 연동 없음
- Upbit 주문 API/Access Key/Secret Key 사용 안 함
- 실주문 없음(PAPER ONLY)

구조
1. collector.js
   Upbit REST + Binance Spot/Futures + Coinbase + CoinGecko + FRED
   15분 고정 CVD / OI 15분·1시간 / BTC dominance 15분·1시간 / ΔScore15

2. Supabase
   gn_runs / gn_snapshots / gn_alerts / gn_overlays

3. dashboard
   휴대폰 브라우저에서
   - 1~4위
   - GN 점수
   - 단계
   - 데이터 품질
   - ΔScore15
   - RS4 / RS24
   - CVD15
   - OI15 / OI1h
   - Funding
   - BTC Dominance
   확인

중요
- Telegram 코드는 완전히 제거됨
- 이메일/메신저 알림도 사용하지 않음
- 휴대폰에서는 웹 대시보드만 확인
- 선발대/본회전 신호는 DB의 gn_alerts에 기록만 함
- ETF/정책/규제/해킹/업그레이드는 gn_overlays에서 중립 5점 유지
- 기존 ChatGPT 이벤트 감시 결과를 보고 필요할 때만 overlay 보정

배포 순서
A. Supabase
1) 새 프로젝트 생성
2) SQL Editor
3) supabase_schema.sql 전체 실행
4) Project URL 확인
5) service_role/secret key 확인

B. GitHub
1) 이 폴더를 private repository에 업로드
2) render.yaml 포함

C. Render
1) New > Blueprint
2) private GitHub repo 연결
3) SUPABASE_URL 입력
4) SUPABASE_SERVICE_ROLE_KEY 입력
5) Deploy Blueprint

D. 확인
1) gn-rotation-collector > Trigger Run
2) Supabase gn_snapshots에 BTC/ETH/SOL/LINK 저장 확인
3) gn-rotation-dashboard URL 접속
4) DASHBOARD_PASSWORD로 로그인
5) 이후 15분마다 자동 누적

보안
- Upbit API Key를 클라우드에 저장하지 않음
- Supabase service role key는 Render 서버 환경변수에만 저장
- Supabase RLS 활성화
- anon/authenticated 접근 차단
- Dashboard는 Basic Auth 적용
- service role key는 브라우저로 전달되지 않음
