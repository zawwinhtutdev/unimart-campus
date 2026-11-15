# Convenience targets. Everything here is a thin wrapper around plain commands.
.PHONY: run reset test check screenshots clean

PORT ?= 8000

run:            ## start the app
	python3 server.py --port $(PORT)

reset:          ## reseed demo data (keeps shopper accounts)
	python3 server.py --port $(PORT) --reset

test:           ## run the API test suite
	python3 -m unittest discover -s tests -v

check:          ## syntax-check the server and every script
	python3 -m py_compile server.py
	for f in js/*.js js/vendor/*.js admin/*.js; do node --check "$$f"; done

clean:          ## remove the local database and uploaded slips
	rm -rf data/store.db data/store.db-wal data/store.db-shm data/proofs
