FROM hub.getyodlr.com/nodejs-yodlr
MAINTAINER Ross Kukulinski "ross@getyodlr.com"

WORKDIR /src

# Install app dependencies
RUN apt-get -yqq update
RUN apt-get -yqq install python2.7 git-all pkg-config libncurses5-dev libssl-dev libnss3-dev libexpat-dev

ADD package.json /src/package.json
RUN npm install

ADD . /src/

RUN rm /root/.ssh/id_rsa

# environment
CMD ["/usr/bin/npm", "test"]
