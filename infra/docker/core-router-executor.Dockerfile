FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ARG APT_MIRROR=mirrors.aliyun.com
ARG XLINGS_GITHUB_MIRROR=https://gh.llkk.cc/https://github.com

RUN sed -i "s|http://archive.ubuntu.com/ubuntu|http://${APT_MIRROR}/ubuntu|g; s|http://security.ubuntu.com/ubuntu|http://${APT_MIRROR}/ubuntu|g" /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get update && apt-get install -y \
  build-essential \
  curl \
  git \
  ca-certificates \
  ninja-build \
  xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 app \
  && useradd -m -u 10001 -g app -s /bin/bash app

WORKDIR /app
COPY apps/core-router-executor apps/core-router-executor
RUN chown -R app:app /app

USER app
ENV HOME=/home/app
ENV PATH="/home/app/.xlings/subos/current/bin:/home/xlings/.xlings/subos/current/bin:${PATH}"

RUN export XLINGS_NON_INTERACTIVE=1 \
  && export XLINGS_GITHUB_MIRROR="${XLINGS_GITHUB_MIRROR}" \
  && git config --global url."${XLINGS_GITHUB_MIRROR}/".insteadOf "https://github.com/" \
  && curl -fsSL https://d2learn.org/xlings-install.sh | bash \
  && export XLINGS_GITHUB_MIRROR="${XLINGS_GITHUB_MIRROR}" \
  && /home/app/.xlings/bin/xlings install gcc@15 xmake -y \
  && XMAKE_REAL="$(find /home/app/.xlings/data/xpkgs/xim-x-xmake -type f -name xmake | head -n 1)" \
  && test -n "${XMAKE_REAL}" && test -x "${XMAKE_REAL}" \
  && "${XMAKE_REAL}" --version

WORKDIR /app/apps/core-router-executor

RUN XMAKE_REAL="$(find /home/app/.xlings/data/xpkgs/xim-x-xmake -type f -name xmake | head -n 1)" \
  && CC=/usr/bin/gcc CXX=/usr/bin/g++ "${XMAKE_REAL}" f --toolchain=gcc -y \
  && CC=/usr/bin/gcc CXX=/usr/bin/g++ "${XMAKE_REAL}" build -y

EXPOSE 4001

CMD ["./build/linux/x86_64/release/core-router-executor"]
