import { Errors, isObject } from './util'

const EVENT_TYPE = {
  BROADCAST: 'Broadcast',
  UNICAST: 'Unicast'
}

const formatObData = (obData) => {
  const result = {}
  for (const key of Object.keys(obData)) {
    const value = obData[key]
    if (typeof value === 'string') {
      result[key] = {
        state: value
      }
    } else if (isObject(value)) {
      if (value.state) {
        result[key] = value
      } else {
        throw new Error(Errors.stateIsRequired(key))
      }
    } else {
      throw new Error(Errors.wrongObDataType(key, typeof value))
    }
  }
  return result
}

const formatEvents = (events, context) => {
  const result = {}
  for (const key of Object.keys(events)) {
    const value = events[key]
    if (typeof value === 'function') {
      const socket = context.$options.obvious.socket ?? context.$socket
      result[key] = {
        socket,
        handler: (...args) => {
          const result = value.call(context, ...args)
          return result
        }
      }
    } else {
      const socket = value.socket ?? context.$options.obvious.socket ?? context.$socket
      result[key] = {
        socket,
        handler: (...args) => {
          return value.handler.call(context, ...args)
        }
      }
    }
  }
  return result
}

const initNewData = (originalData) => {
  let newData = {}
  if (typeof originalData === 'function') {
    newData = {
      ...originalData()
    }
  } else if (isObject(originalData)) {
    newData = {
      ...originalData
    }
  }
  return newData
}

const injectObData = (dataOption, dataName, socket, state) => {
  const stateValue = socket.getState(state)
  const dataValue = stateValue === undefined ? null : stateValue
  dataOption[dataName] = dataValue
}

const injectObDataWatcher = (watchOption, dataName, socket, state) => {
  const rootStateName = state.split('.')[0]
  const handler = (newValue) => {
    socket.waitState([rootStateName]).then(() => {
      socket.setState(state, newValue)
    })
  }
  watchOption[dataName] = {
    handler,
    deep: true
  }
}

const injectStateWatcher = (dataName, socket, state, context) => {
  context.$nextTick(() => {
    const rootStateName = state.split('.')[0]
    socket.waitState([rootStateName]).then(() => {
      context[dataName] = socket.getState(state)
      const handler = (newValue) => {
        context[dataName] = newValue
      }
      context.$obStateWatcher[state] = {
        socket,
        handler
      }
      socket.watchState(state, handler)
    })
  })
}

const listenEvents = (type, events) => {
  Object.keys(events).forEach((eventName) => {
    const { handler, socket } = events[eventName]
    socket[`on${type}`](eventName, handler)
  })
}

export default {
  beforeCreate () {
    this.$obStateWatcher = {}
    const { data: originalData, watch: originalWatch, obvious: _obvious } = this.$options
    const obvious = typeof _obvious === 'function' ? _obvious.call(this) : _obvious
    if (isObject(obvious)) {
      const dataOption = initNewData(originalData)
      const watchOption = originalWatch ? { ...originalWatch } : {}
      const {
        socket: componentSocket,
        data: originalObData,
        broadcast,
        unicast
      } = obvious

      // inject data and watch
      if (isObject(originalObData)) {
        const obData = formatObData(originalObData)
        Object.keys(obData).forEach((dataName) => {
          const { state, socket: stateSocket } = obData[dataName]
          const socket = stateSocket ?? componentSocket ?? this.$socket
          injectObData(dataOption, dataName, socket, state)
          injectObDataWatcher(watchOption, dataName, socket, state)
          injectStateWatcher(dataName, socket, state, this)
        })
        if (isObject(originalData)) {
          this.$options.data = dataOption
        } else {
          this.$options.data = function () {
            return dataOption
          }
        }
        this.$options.watch = watchOption
      }

      // listen broadcast
      if (isObject(broadcast)) {
        this.$broadcastEvents = formatEvents(broadcast, this)
        listenEvents(EVENT_TYPE.BROADCAST, this.$broadcastEvents)
      }

      // listen unicast
      if (isObject(unicast)) {
        this.$unicastEvents = formatEvents(unicast, this)
        listenEvents(EVENT_TYPE.UNICAST, this.$unicastEvents)
      }
    }
  },

  beforeDestroy () {
    // clear obvious state watcher
    isObject(this.$obStateWatcher) && Object.keys(this.$obStateWatcher).forEach((stateName) => {
      const { socket, handler } = this.$obStateWatcher[stateName]
      socket.unwatchState(stateName, handler)
    })
    // clear broadcast event handler
    isObject(this.$broadcastEvents) && Object.keys(this.$broadcastEvents).forEach((eventName) => {
      const { socket, handler } = this.$broadcastEvents[eventName]
      socket.offBroadcast(eventName, handler)
    })
    // clear unicast event handler
    isObject(this.$unicastEvents) && Object.keys(this.$unicastEvents).forEach((eventName) => {
      const { socket, handler } = this.$unicastEvents[eventName]
      socket.offUnicast(eventName, handler)
    })
  }
}
